import View from 'view';
import Storage from 'storage'
var newZip = new JSZip();

const MAX_HEIGHT = 375;

//TODO 
  
  //Clean up article title filtering/regex (caps, punctuation, etc)
  //Handle pagination issue on Untranslated
  //Add full language names and flags to dropdowns where needed (prob seperate API call or resource)
  //Handling marked as outdated
    //Cannot use timestamp
    //Look into read-only "outdated" property (see thread with Zendesk support)
  //Need to check for articles that dont exist in Qordoba but do in ZD (i.e. articles translated before Qordoba integration)
  //Enable batch sending of articles to Qordoba
  //Add "edit" links to content root
  //Need to get inactive locales from both ZD and Q and represent each in UI (currently only representing those NOT in Q)

  //Implement basic search -- exact match only
  //Implement sortable fields
  //Qordoba auth -- make dynamic -- add token on proj creation instead of username pw
  //Add "How To Install" instructions
  //Need to handle other types (sections, categories, etc) -- LATER



class NavBar {
  constructor(client, data) {
    this.view = new View();
    this.view.switchTo('loading');
    this.client = client;
    this._metadata = data.metadata;

    this.currentPage = 'articles'; // need to actually grab from API call 

    this.filesToUpload = {};
    this.filesToUpdate = {};

    this.zendeskArticles = {};
    this.zendeskArticles.articles = [];

    this.qordobaArticles = {};
    this.qordobaProjectActiveLanguages = {};

    this.zendeskArticlesWithExistingTranslations = {};
    this.localeTranslationsMissingFromQordoba = {};

    this.userSettings = {};

    this.qordobaProjectId;
    this.qordobaAuthToken;
    this.qordobaOrganization;
    this.qordobaLanguageId;

    this.langCode;
    this.localeCode;
    this.sourceLocale;

    this.currentlyTranslated = false;
    this.completedTranslationsExist = false;

    this.sampleTargetLocale;

    this.pageNumber = 1;
    this.limit = 10;
    this.offset = (this.pageNumber * this.limit) - this.limit;
    this.morePagesExist;

    this.pageParams = {
      project_name: '', 
      page: this.currentPage, 
      page_articles: this.currentPage === 'articles',
      page_categories: this.currentPage === 'categories',
      page_sections: this.currentPage === 'sections',
      page_dynamic_content: this.currentPage === 'dynamic',
      dataset: [],
      langs: [],
      has_more_langs: false,
      search_term: '', // need to actually grab
      currentLanguageLocale: ''
    };

    this.jsonReqHeader = {};

    this.init();
  }


/*****************MASTER METHODS***********************
  *****************************************************/

  async init() {
    await this.processQordobaCredentials();
    this.jsonReqHeader = {'X-AUTH-TOKEN': this.qordobaAuthToken,'Content-Type': 'application/json'};
    // await this.getQordobaAuthToken(); // TODO After ZD approval, enable "real" auth
    await this.getZendeskProjectLanguages();
    await this.getQordobaProjectLanguages();
    await this.setZendeskPageParams();
    this.pageParams.currentLanguageLocale = this.pageParams.currentLanguageLocale || this.sourceLocale; 
    this.qordobaLanguageId = null;

    this.qordobaArticles = {};
    this.zendeskArticles = {};
    this.zendeskArticles.articles = [];
    this.localeTranslationsMissingFromQordoba = {};
    this.completedTranslationsExist = false;

    this.getAnyTargetLocale();
    await this.setLanguages();
    await this.getAllData();
    //TODO PICKUP CODE CLEANUP HERE
    //TODO PICKUP CODE CLEANUP HERE
    //TODO PICKUP CODE CLEANUP HERE
    await this.renderZendeskSyncPage();
    await this.setAllResourceAndDomNodeStauses();
  }

  setLanguages() {
    console.log('setting languages', this.pageParams.currentLanguageLocale);
    if (this.pageParams.currentLanguageLocale.length > 2) {
      this.langCode = this.pageParams.currentLanguageLocale.slice(0,2);
      this.localeCode = this.pageParams.currentLanguageLocale.slice(3,5);
      this.zendeskLocale = `${this.langCode}-${this.localeCode}`;
    }
    else {
      this.langCode = this.pageParams.currentLanguageLocale.slice(0,2);
      this.localeCode = this.langCode;
      this.zendeskLocale = this.langCode;
    }
    var qordobaLanguageIdObj = this.qordobaProjectActiveLanguages[`${this.langCode}-${this.localeCode}`] || this.qordobaProjectActiveLanguages[this.sampleTargetLocale];
    console.log(qordobaLanguageIdObj, 'QLANGIDOBJ')
    this.qordobaLanguageId = qordobaLanguageIdObj.id;
    this.qordobaLanguageFullName = qordobaLanguageIdObj.fullName;
  }

  async getAllData() {
    this.zendeskUser = await this.getZendeskUser();
    await this.getQordobaArticles();
    await this.getZendeskArticles();
    console.log('GOT ALL DATA', this)
  }


  /*****************API CALLS***********************
  *****************************************************/

  //***********ZENDESK API CALLS***********************

  async publishZendeskArticles(completeZipFile) {
    JSZipUtils.getBinaryContent(`https://app.qordoba.com/api/file/download?token=${completeZipFile.token}&filename=${encodeURIComponent(completeZipFile.filename)}`, async (err, data) => {

      console.log('first data', data)
      var completedZipDataObj = await newZip.loadAsync(data);
      var completedZipData = completedZipDataObj.files;

      console.log('zipdat/', completedZipData)
      for (var key in completedZipData) {
        var myRegexp = /.*\/([a-z, A-Z, \s, ( , ) , !, ?]*).*.html/g;
        var regexMatches = myRegexp.exec(key);
        console.log('REGEXMATCHES', regexMatches)
        var articleName = regexMatches[1];
        console.log('articlename', articleName)
        if (this.qordobaArticles[articleName] && this.qordobaArticles[articleName].completed && key.slice(0,2) === this.langCode) {
          var finalizedZipData = await completedZipData[key].async('text');
          console.log('finalizedZipData', finalizedZipData)
          var translationReq = {
            translation: {
              body: finalizedZipData,
            }
          }

          for (var i = 0; i < this.zendeskArticles.articles.length; i++) {
            var currentLowercaseTitle = this.zendeskArticles.articles[i].title;
            if (articleName === currentLowercaseTitle && !this.zendeskArticles.articles[i].draft) {
              console.log('found a ZD article to publish!')
              translationReq.translation.locale = this.zendeskLocale;
              translationReq.translation.title = this.zendeskArticles.articles[i].title;
              var resourceId = this.zendeskArticles.articles[i].id;
              try {
                var resourceExists = await this.client.request({
                  url: `/api/v2/help_center/articles/${resourceId}/translations/${this.zendeskLocale}.json`,
                  type: 'GET'
                })
                console.log('list', resourceExists)
                console.log('RESOURCE EXISTS')

                if (this.localeTranslationsMissingFromQordoba[resourceId]) {
                  console.log('found an existing, published article with an outdated translation!! updating')
                  try {
                    var zendeskTranslationResponse = await this.client.request({
                      url: `/api/v2/help_center/articles/${resourceId}/translations/${this.zendeskLocale}.json`,
                      type: 'POST',
                      data: JSON.stringify(translationReq),
                      contentType: 'application/json'
                    })
                    console.log('ZD article updated', zendeskTranslationResponse);
                  }
                  catch(error) {
                    console.log('ERROR UPDATING EXISTING', error)
                  }
                }
              }

              catch(error) {
                console.log('resource doesnt exist', error)
                if (error.responseJSON.error === 'RecordNotFound') {
                  console.log('translation doesnt exist -- creating one now')
                    var zendeskTranslationResponse = await this.client.request({
                      url: `/api/v2/help_center/articles/${resourceId}/translations.json`,
                      type: 'POST',
                      data: JSON.stringify(translationReq),
                      contentType: 'application/json'
                    })
                  console.log('ZD article created', zendeskTranslationResponse)
                }
              }              
            }
          }
        }
      }
    });
  }




  getZendeskUser() {
    return this.client.request({ url: '/api/v2/users/me.json' })
  }




  getZendeskBrands() {
    return this.client.request({ url: '/api/v2/brands.json' })
  }



  async getZendeskProjectLanguages() {
    this.localeData = await this.client.request({
      url: `/api/v2/help_center/locales.json`,
      type: 'GET'
    })
    this.sourceLocale = this.localeData.default_locale;
  }



  async getZendeskArticles() {
    var sourceRequestParams = {
      url: `/api/v2/help_center/articles.json?page=${this.pageNumber}&per_page=${this.limit}&offset=${this.offset}&sort_by=updated_at&sort_order=desc`,
      type: 'GET',
      dataType: 'json'
    };
    var articlesInSourceResponse = await this.client.request(sourceRequestParams);
    var articlesInSource = articlesInSourceResponse.articles;
    var zendeskArticleCounter = 0;

    for (var i = 0; i < articlesInSource.length; i++) {
      zendeskArticleCounter++;
      if (this.currentlyTranslated) {
        if (this.qordobaArticles[articlesInSource[i].title]) {
        //If this source article from Zendesk exists in Qordoba
          if (articlesInSource[i].outdated_locales.indexOf(`${this.langCode}-${this.localeCode}`) !== -1 || articlesInSource[i].outdated_locales.indexOf(this.langCode) !== -1) {
          //If this article is outdated for current languages
            this.localeTranslationsMissingFromQordoba[articlesInSource[i].id] = true;
          }
          this.zendeskArticles.articles.push(articlesInSource[i]);
        }
      }
      else {
        if (!this.qordobaArticles[articlesInSource[i].title]) {
          //If we dont find the article in Qordoba
          this.zendeskArticles.articles.push(articlesInSource[i]);
        }
      }
    }
    this.morePagesExist = zendeskArticleCounter === 10;
  }




  getAnyTargetLocale() {
    for (var i = 0; i < this.pageParams.activeLanguages.length; i++) {
      if (this.pageParams.activeLanguages[i].name.length === 5) {
        this.sampleTargetLocale = this.pageParams.activeLanguages[i].name;
      }
    }
  }


  async setZendeskPageParams() {
    console.log('setting page params')

    this.pageParams.activeLanguages = [];

    for (var i = 0; i < this.localeData.locales.length; i++) {
      var foundMatchInQProj = false;
      var zendeskLocale = this.localeData.locales[i];
      if (zendeskLocale !== this.sourceLocale) {
        if (this.qordobaProjectActiveLanguages[zendeskLocale]){
          //full match
          foundMatchInQProj = true;
          var pageLangObj = {name: zendeskLocale, fullName: this.qordobaProjectActiveLanguages[zendeskLocale].fullName, zendeskLocale: zendeskLocale};
          if (zendeskLocale === `${this.langCode}-${this.localeCode}`) {
            pageLangObj.selected = true;
          } else {
            pageLangObj.selected = false;
          }
          this.pageParams.activeLanguages.push(pageLangObj);
        }
        else if (zendeskLocale.length < 5){
          //partial match
          for (var key in this.qordobaProjectActiveLanguages) {
            if (key.slice(0,2) === zendeskLocale) {
              foundMatchInQProj = true;
              var pageLangObj = {name: zendeskLocale, fullName: `${this.qordobaProjectActiveLanguages[key].fullName} (partial match)`, zendeskLocale: zendeskLocale.slice(0,2)};
              if (zendeskLocale === this.langCode) {
                pageLangObj.selected = true;
              } else {
                pageLangObj.selected = false;
              }
              this.pageParams.activeLanguages.push(pageLangObj);
            }
          }
        }
        if (!foundMatchInQProj){
          //no match
          var pageLangObj = {name: zendeskLocale, fullName: `${zendeskLocale} (no match)`, zendeskLocale: zendeskLocale, selected: false};
          this.pageParams.zendeskLocalesNotPartOfQordobaProject = [];
          console.log('pushing page lang obj', pageLangObj)
          this.pageParams.zendeskLocalesNotPartOfQordobaProject.push(pageLangObj)
        }
      }
    }
  }

  //************QORDOBA API CALLS***********************

  async processQordobaCredentials() {
    var userSettingsResponse = await this.client.metadata();
    this.userSettings = userSettingsResponse.settings;
    this.qordobaOrganization = this.userSettings['Qordoba Organization Id'];
    this.qordobaProjectId = this.userSettings['Qordoba Project Id'];
    this.qordobaAuthToken = this.userSettings['Qordoba X-Auth Token'];
  }



  async getQordobaProjectLanguages() {
    var projectDetailCall = await $.ajax({
      type: 'GET',
      url: `https://app.qordoba.com/api/organizations/${this.qordobaOrganization}/projects?limit=1&offset=0&limit_to_projects=${this.qordobaProjectId}`,
      headers: this.jsonReqHeader
    })
    console.log('PROJECT DETAIL CALL!!!', projectDetailCall)
    var projectTargetLanguageObjectArray = projectDetailCall.projects[0].target_languages;
    for (var i = 0; i < projectTargetLanguageObjectArray.length; i++) {
      this.qordobaProjectActiveLanguages[projectTargetLanguageObjectArray[i].code] = {};
      this.qordobaProjectActiveLanguages[projectTargetLanguageObjectArray[i].code].id = projectTargetLanguageObjectArray[i].id;
      this.qordobaProjectActiveLanguages[projectTargetLanguageObjectArray[i].code].name = projectTargetLanguageObjectArray[i].code;
      this.qordobaProjectActiveLanguages[projectTargetLanguageObjectArray[i].code].fullName = projectTargetLanguageObjectArray[i].name;
    }
  }


  async getQordobaArticles() {
    try {
      var qordobaResponse = await $.ajax({
        type: 'POST',
        url: `https://app.qordoba.com/api/projects/${this.qordobaProjectId}/languages/${this.qordobaLanguageId}/page_settings/search?limit=${this.limit}&offset=${this.offset}`,
        headers: this.jsonReqHeader,
        data: JSON.stringify({})
      })
      console.log('q response', qordobaResponse)
      for (var i = 0; i < qordobaResponse.pages.length; i++) {
        var urlWithoutHtml = qordobaResponse.pages[i].url.replace('.html', '');
        this.qordobaArticles[urlWithoutHtml] = {};
        this.qordobaArticles[urlWithoutHtml].enabled = qordobaResponse.pages[i].enabled;
        this.qordobaArticles[urlWithoutHtml].completed = qordobaResponse.pages[i].completed;
        this.qordobaArticles[urlWithoutHtml].qordobaPageId = qordobaResponse.pages[i].page_id;
        this.qordobaArticles[urlWithoutHtml].lastUpdatedAt = qordobaResponse.pages[i].update;
      }
    }
    catch(error) {
      console.log('ERROR GRABBING LOCALIZED QORDOBA ARTICLES', error)
      window.alert('Need to create qordoba proj for language') //Going to send you back to proj linkage or to Qordoba CR
      console.log('Need to create qordoba proj for language')
    }
  }



  async getFileDetailFromQordoba() {
    var pageIdArray = [];
    for (var key in this.qordobaArticles) {
      pageIdArray.push(this.qordobaArticles[key].qordobaPageId);
    }

    var completeZipFile = await $.ajax({
      type: 'POST',
      url: `https://app.qordoba.com/api/projects/${this.qordobaProjectId}/export_files_bulk`,
      data: JSON.stringify({
        bilingual: false,
        compress_columns: false,
        language_ids: [Number(this.qordobaLanguageId)],
        original_format: false,
        page_ids: pageIdArray
      }),
      headers: this.jsonReqHeader,
    })
    console.log('RESPONSE COMP FILE', completeZipFile)
    await this.publishZendeskArticles(completeZipFile); //TODO move so we dont call from in here
  }



  async sendResourceToQordoba(articleName, articleId, updateOrUpload) {
    this.view.switchTo('loading');
    await this.getZendeskArticleDetail(articleName, articleId)

    var objectString = `filesTo${updateOrUpload}`;
    var filesToSend = this[objectString];

    var fileToUpload = new File([filesToSend[articleName].file], `${articleName}.html`, {
      type: "text/html"
    })

    var fd = new FormData();
    fd.append('project_id', this.qordobaProjectId);
    fd.append('file_names', `[]`);
    fd.append('file', fileToUpload);

    var qordobaSendFilesRequest = {
      type: 'POST',
      contentType: false,
      processData: false,
      data: fd,
      headers: {'X-AUTH-TOKEN': this.qordobaAuthToken}
    }

    if (this.currentlyTranslated) {
      qordobaSendFilesRequest.url = `https://app.qordoba.com/api/projects/${this.qordobaProjectId}/files/${this.qordobaArticles[`${articleName}.html`].qordobaPageId}/update/upload`;
      var qordobaSendFilesResponse = await $.ajax(qordobaSendFilesRequest);
      var responseToFilesUpdated = await $.ajax({
        type: 'PUT',
        url: `https://app.qordoba.com/api/projects/${this.qordobaProjectId}/files/${this.qordobaArticles[`${articleName}.html`].qordobaPageId}/update/apply`,
        data: JSON.stringify({
          new_file_id: qordobaFileUpdateResponse.id,
          keep_in_project: false
        }),
        headers: {
          'X-AUTH-TOKEN': this.qordobaAuthToken,
          'Content-Type': 'application/json'
        }
      })
      console.log('update response', responseToFilesUpdated)
      delete this.localeTranslationsMissingFromQordoba[resourceId];
      this.setIndividualResourceStatus(rowToBeUpdated, articleName);
      //TODO HANDLE PUBLISH OF YPDATED ARTICLE?
    } else {
      console.log('correct block')
      qordobaSendFilesRequest.url = `https://app.qordoba.com/api/organizations/${this.qordobaOrganization}/upload/uploadFile_anyType?content_type_code=stringsHtml&projectId=${this.qordobaProjectId}`;
      var qordobaSendFilesResponse = await $.ajax(qordobaSendFilesRequest);
      var responseToFilesUpdated = await $.ajax({
        type: 'POST',
        url: `https://app.qordoba.com/api/projects/${this.qordobaProjectId}/append_files`,
        data: JSON.stringify([{
          content_type_codes: [{name: "Html String", content_type_code: "stringsHtml", extensions: ["html"]}],
          file_name: qordobaSendFilesResponse.file_name,
          id: qordobaSendFilesResponse.upload_id,
          source_columns: [],
          version_tag: ""
        }]),
        headers: {
          'X-AUTH-TOKEN': this.qordobaAuthToken,
          'Content-Type': 'application/json'
        }
      })
    }

      this.filesToUpload = {};

      this.init();
  }


//TODO also make upload or upccate argumnet
  getZendeskArticleDetail(articleName, articleId) {
    return this.client.request(`/api/v2/help_center/articles/${articleId}.json`)
    .then((articleData) => {
      console.log('ARTICLE DATA', articleData)
      if (!this.currentlyTranslated) {
        this.filesToUpload[articleName].url = articleData.article.html_url;
        this.filesToUpload[articleName].file = articleData.article.body;
        this.filesToUpload[articleName].project_id = this.qordobaProjectId;
        this.filesToUpload[articleName].file_names = articleName;
      }
      else {
        console.log('RESPONSE AFTE3R SENDING', articleName)
        console.log('RESPONSE AFTE3R SENDING', this.filesToUpdate[articleName])
        this.filesToUpdate[articleName].url = articleData.article.html_url;
        console.log('RESPONSE AFTE3R SENDING', this.filesToUpdate[articleName])
        this.filesToUpdate[articleName].file = articleData.article.body;
        this.filesToUpdate[articleName].project_id = this.qordobaProjectId;
        this.filesToUpdate[articleName].file_names = articleName; 
      }
    })
  }

  /*****************UTILITIES***********************
  *****************************************************/

  //************UI UTILITIES***********************
  

  //incomplete
  async setIndividualResourceStatus(listRowElement, articleName) {
    var resourceIdArray = listRowElement.dataset.resource.split('-');
    var resourceId = resourceIdArray[resourceIdArray.length - 1];

    var allResourceCheckboxes = document.querySelectorAll('input.js-articles');

    var resourceStatusCheckingSpan = listRowElement.children[0].children[0].children[4].children[0];
    resourceStatusCheckingSpan.dataset.resourceId = resourceId;
    var resourceStatusCompletedSpan = listRowElement.children[0].children[0].children[4].children[1];
    resourceStatusCompletedSpan.dataset.resourceId = resourceId;
    var resourceStatusNotExistSpan = listRowElement.children[0].children[0].children[4].children[2];
    resourceStatusNotExistSpan.dataset.resourceId = resourceId;
    var resourceStatusInProgressSpan = listRowElement.children[0].children[0].children[4].children[3];
    resourceStatusInProgressSpan.dataset.resourceId = resourceId;
    var resourceStatusErrorSpan = listRowElement.children[0].children[0].children[4].children[4];
    resourceStatusErrorSpan.dataset.resourceId = resourceId;
    var resourceCheckBox = listRowElement.children[0].children[0].children[0].children[0].children[0].children[0];
    resourceCheckBox.dataset.resourceId = resourceId;
    var resourceLink = listRowElement.children[0].children[0].children[2].children[1];

    resourceCheckBox.addEventListener('click', (e) => {
      var uploadButton = document.querySelector('.js-batch-upload');
      if (e.target.checked) {
        if (!this.currentlyTranslated) {
          this.filesToUpload[articleName] = {};
          this.filesToUpload[articleName].id = e.target.dataset.resourceId //really needs to be the ID of the article im going to send to Qordoba
          uploadButton.classList.remove('is-disabled');
        } 
        else {
          this.filesToUpdate[articleName] = {};
          this.filesToUpdate[articleName].id = e.target.dataset.resourceId //really needs to be the ID of the article im going to send to Qordoba
          uploadButton.classList.remove('is-disabled');
          console.log('FILES TO UPDATE', this.filesToUpdate)
        }
        for (var i = 0; i < allResourceCheckboxes.length; i++) {
          if (allResourceCheckboxes[i] !== resourceCheckBox) {
            allResourceCheckboxes[i].disabled = true;
          }
        }
      } else {
        if (!this.currentlyTranslated) {
          delete this.filesToUpdate[articleName];
          if (Object.keys(this.filesToUpdate).length === 0) {
            uploadButton.classList.add('is-disabled');
          }
        } 
        else {
          delete this.filesToUpload[articleName];
          if (Object.keys(this.filesToUpload).length === 0) {
            uploadButton.classList.add('is-disabled');
          }
        }
        for (var i = 0; i < allResourceCheckboxes.length; i++) {
          allResourceCheckboxes[i].disabled = false;
        }           
      }
    });


    if (!this.qordobaArticles[articleName]) {
      resourceLink.disabled = true;
      //Resource isnt in Qordoba

      //Resource Status
      resourceStatusCheckingSpan.classList.add('is-hidden');
      resourceStatusNotExistSpan.classList.remove('is-hidden');
      resourceStatusErrorSpan.classList.add('is-hidden');
      resourceStatusInProgressSpan.classList.add('is-hidden');
      resourceStatusCompletedSpan.classList.add('is-hidden');

      //Checkbox
      resourceCheckBox.disabled = false;
    }

    else if (this.qordobaArticles[articleName].completed) {
      for (var i = 0; i < this.zendeskArticles.articles.length; i++) { //TODO lets just make this a fuckin object
        if (Number(this.zendeskArticles.articles[i].id) === Number(resourceId) && !this.zendeskArticles.articles[i].draft) {
          resourceLink.href = this.zendeskArticles.articles[i].html_url.replace(this.sourceLocale, this.zendeskLocale);
          resourceLink.disabled = false;
        } else {
          resourceLink.disabled = true;
        }
      }
      resourceStatusCompletedSpan.classList.remove('is-hidden');
      resourceStatusNotExistSpan.classList.add('is-hidden');
      resourceStatusCheckingSpan.classList.add('is-hidden');

      resourceCheckBox.checked = false;
      resourceCheckBox.disabled = true;
      resourceCheckBox.classList.add('js-can-upload');

      // await this.getFileDetailFromQordoba(articleName, resourceId)
    }

    else if (this.qordobaArticles[articleName].enabled) {
      resourceLink.disabled = true;

       //Right now, only setting as in progress, not complete
      resourceStatusInProgressSpan.classList.remove('is-hidden');
      resourceStatusNotExistSpan.classList.add('is-hidden');
      resourceStatusCheckingSpan.classList.add('is-hidden');

      //Need to handle completed languages

      resourceCheckBox.checked = false;
      resourceCheckBox.disabled = true;
      resourceCheckBox.classList.add('js-can-upload');

      // if (this.qordobaArticles[articleName].justUpdated) {
      //   await this.getFileDetailFromQordoba(articleName, resourceId);
      // }
    }

    if (this.localeTranslationsMissingFromQordoba[resourceId] && this.qordobaArticles[articleName].completed) {
      //Add error block from row
      console.log('found lang IS marked as outdated')
      resourceStatusErrorSpan.classList.remove('is-hidden');
      resourceStatusErrorSpan.classList.add('o-badge');
      resourceStatusErrorSpan.style.backgroundColor = 'red'
      resourceStatusErrorSpan.innerHTML = 'OUTDATED';
      resourceCheckBox.disabled = false;
    }
    else {
      //hide error block from row
      console.log('found lang not marked as outdated')
      resourceStatusErrorSpan.classList.add('is-hidden');
    }
  }

  //incomplete
  async setAllResourceAndDomNodeStauses() {

    //Need to update UI to mark anything existing in this.zendeskLocalesNotPartOfQordobaProject //TODO
    var untranslatedButton = document.querySelector(`[data-button="untranslated"]`);
    var uploadButton = document.querySelector('.js-batch-upload');
    var targetLangNotSelectedRow = document.querySelector('[data-value="Active Locales"]');
    var otherLocaleLinks = document.querySelectorAll('[data-function="lang"]');
    var dropdownToggle = document.querySelector('select.dropdown-toggle.active-locales');
    var nextPageButton = document.querySelector('.js-goto-next');
    var prevPageButton = document.querySelector('.js-goto-prev');
    var refreshButton = document.querySelector('a.js-refresh');

    refreshButton.addEventListener('click', (e) => {
      this.view.switchTo('loading');
      this.init();
    });

    if (this.dropdownIndexForTargetLanguage) {
      dropdownToggle.options.selectedIndex = this.dropdownIndexForTargetLanguage
    }

    if (this.currentlyTranslated) {
      dropdownToggle.classList.add('selected-locale');
      untranslatedButton.classList.remove('selected-locale');
    } else {
      dropdownToggle.classList.remove('selected-locale');
      untranslatedButton.classList.add('selected-locale');
    }

    dropdownToggle.addEventListener('change', (e) => {
      var targetRow = e.target.querySelector(`option.${e.target.value}`)
      this.currentlyTranslated = true;
      this.pageParams.currentLanguageLocale = e.target.value;
      this.pageNumber = 1;
      this.dropdownIndexForTargetLanguage = e.target.selectedIndex;
      this.view.switchTo('loading');
      this.init();
    });

    if (nextPageButton) {
      nextPageButton.addEventListener('click', (e) => {
        this.view.switchTo('loading');
        this.pageNumber++;
        this.init();
      });
    }

    if (prevPageButton) {
      prevPageButton.addEventListener('click', (e) => {
        this.view.switchTo('loading');
        this.pageNumber--;
        this.init();
      });
    }

    untranslatedButton.addEventListener('click', (e) => {
      this.view.switchTo('loading');
      this.pageParams.currentLanguageLocale = this.sourceLocale;
      this.pageNumber = 1;
      this.dropdownIndexForTargetLanguage = 0;
      this.currentlyTranslated = false;
      dropdownToggle.classList.remove('selected-locale');
      untranslatedButton.classList.add('selected-locale');
      this.init()
    });

    uploadButton.addEventListener('click', (e) => {
      if (Object.keys(this.filesToUpload).length > 0) {
        for (var key in this.filesToUpload) {
          this.sendResourceToQordoba(key, this.filesToUpload[key].id, 'Upload');
        } 
      }
      else {
        for (var key in this.filesToUpdate) {
          this.sendResourceToQordoba(key, this.filesToUpdate[key].id, 'Update');
        } 
      }
    });

    for (var k = 0; k < this.zendeskArticles.articles.length; k++) {
      var listRowElement = document.querySelector(`[data-resource="${this.pageParams.page}-${this.zendeskArticles.articles[k].id}"]`);
      var articleName = this.zendeskArticles.articles[k].title;
      if (!this.zendeskArticles.articles[k].draft && this.qordobaArticles[articleName] && this.qordobaArticles[articleName].completed) {
        this.completedTranslationsExist = true;
      } 
      this.setIndividualResourceStatus(listRowElement, this.zendeskArticles.articles[k].title);
    }

    if (this.completedTranslationsExist) {
      console.log('we have comp trans')
      await this.getFileDetailFromQordoba();
    }
  }


  //************ZENDESK UTILITIES***********************

  reconstructZendeskArticleObject(articleObject) {
    console.log('ARTICLE OBJECT', articleObject)
    var qordobaPublished = this.qordobaArticles[articleObject.title] || {completed: false};
    var reconstructedArticleObject = {
      name: `${this.pageParams.page}-${articleObject.id}`,
      title_string: articleObject.title,
      zd_object_updated: moment(articleObject.updated_at).format('MMM D YYYY h:mma'),
      zd_object_url : articleObject.html_url,
      zd_outdated: false,
      source_published: !articleObject.draft,
      target_published: qordobaPublished.completed,
      fullName: this.qordobaLanguageFullName,
      qordoba_resource_url: articleObject.html_url 
    }
    return reconstructedArticleObject;
  }

  renderZendeskSyncPage() {
    this.pageParams.paginationVisible = true; 
    this.pageParams.prevPageEnabled = this.pageNumber > 1;
    this.pageParams.nextPageEnabled = this.morePagesExist;
    this.pageParams.dataset = this.zendeskArticles.articles.map((articleObject) => {
      return this.reconstructZendeskArticleObject(articleObject);
    })
    return this.view.switchTo('QordobaHome', this.pageParams);
  }
}

export default NavBar;