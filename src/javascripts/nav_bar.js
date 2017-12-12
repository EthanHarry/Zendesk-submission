import View from 'view';
import Storage from 'storage';
var newZip = new JSZip();

const MAX_HEIGHT = 375;

  //FUTURE
  //Dont call for languages and brands every time we re-init -- you already have them
  //Work on signle source of truth for data -- dont need pageparams to be seperate from actual data
  //Handle Cases where we have locale only (no lang)
  //Way to publish translations without pushing them to "Completed" when source is "Draft"
  //Handling marked as outdated
    //Need Automatic way to identify outdated
    //Cannot use timestamp
    //Look into read-only "outdated" property (see thread with Zendesk support)
  //Need to get inactive locales from both ZD and Q and represent each in UI (currently only representing those NOT in Q)
  //Bring back select all checkbox and determine behavior
  //Qordoba auth -- make dynamic -- add token on proj creation instead of username pw
  //Implement sortable fields
  //New lang-locale mappings?
  //X-AUTH-TOKEN expiry -- can we actually use it during install? Won't it expire when user terminates session? TEST


class NavBar {
  constructor(client, data) {
    this.view = new View();
    this.view.switchTo('loading');
    this.client = client;
    this._metadata = data.metadata;
    this.oAuthToken;

    this.pageType = 'articles';  

    this.filesToProcess = {};

    this.ZendeskResources = {};
    this.currentZendeskBrand;
    this.zendeskBrands = {};

    this.qordobaData = {};
    this.qordobaProjectActiveLanguages = {};

    this.userSettings = {};

    this.qordobaProjectId;
    this.qordobaAuthToken;
    this.qordobaOrganization;
    this.qordobaLanguageId;

    this.langCode;
    this.localeCode;
    this.sourceLocale;

    this.dropdownIndexForTargetLanguage = 1;
    this.currentZendeskBrandIndex;

    this.pageNumber = 1;
    this.limit = 10;
    this.zendeskOffset = 0;
    this.offset = (this.pageNumber * this.limit) - this.limit;
    this.morePagesExist;
    this.filesReadyToPublish = 0;

    this.pageParams = {
      project_name: '', 
      page: this.pageType, 
      page_articles: '',
      page_categories: '',
      page_sections: '',
      dataset: [],
      has_more_langs: false,
      currentLanguageLocale: '',
      currentZendeskBrand: ''
    };

    this.jsonReqHeader = {};

    this.zendeskSearchTerm = '';

    this.checkOAuthToken();
  }


/*****************MASTER METHODS***********************
  *****************************************************/

  async init() {
    this.pageParams.page_articles = this.pageType === 'articles';
    this.pageParams.page_sections = this.pageType === 'sections';
    this.pageParams.page_categories = this.pageType === 'categories';
    this.pageParams.search_term = this.zendeskSearchTerm;
    this.qordobaData = {};
    this.ZendeskResources = {};
    this.filesToProcess = {};
    this.zendeskParentResources = {};
    this.pageParams.currentLanguageLocale = this.pageParams.currentLanguageLocale || ''; 
    this.pageParams.currentZendeskBrand = this.pageParams.currentZendeskBrand || ''; 
    this.qordobaLanguageId = null;
    this.filesReadyToPublish = 0;

    this.processQordobaCredentials();
    await this.getAndSetZendeskBrands();
    await this.getZendeskResourceList();
    await this.getZendeskProjectLanguages();
    this.jsonReqHeader = {'X-AUTH-TOKEN': this.qordobaAuthToken,'Content-Type': 'application/json'};
    await this.getQordobaProjectLanguages();
    this.setZendeskPageParams();
    this.setLanguages();
    await this.getZendeskResources();
    this.getPublishedZendeskArticles();
    await this.getQordobaResources();
    this.renderZendeskSyncPage();
    this.setAllResourceAndDomNodeStauses();


  }

  async checkOAuthToken() {
    if (!this.oAuthToken) {
      this.client.invoke('notify', 'Authenticating...', 'notice', 10000);
      this.view.switchTo('auth_iframe');
    }
    $(window).on("message", async function(event) {
      var origin = event.origin || event.originalEvent.origin;
      if (origin !== "https://us-central1-qordoba-devel.cloudfunctions.net")
        return;
      var msg = event.data || event.originalEvent.data;
      if (msg.zendeskAuthToken === 'undefined') {
        var clientsResponse = await this.client.request({
          url: `${window.location.ancestorOrigins[0]}/api/v2/oauth/clients.json`,
          type: 'GET',
          cors: true
        })
        var clients = clientsResponse.clients;
        for (var i = 0; i < clients.length; i++) {
          if (clients[i].company === 'Qordoba') {
            var clientId = clients[i].id;
            break;
          }
        }
        this.view.switchTo('start_auth', {initial_brand_name: window.location.ancestorOrigins[0], client_id: clientId});
      } else {
        this.oAuthToken = msg.zendeskAuthToken;
        this.init();
      }
    }.bind(this));
  }

  setLanguages() {
    console.log('current lang locale', this.pageParams.currentLanguageLocale)
    if (this.pageParams.currentLanguageLocale.length > 2) {
      this.langCode = this.pageParams.currentLanguageLocale.slice(0,2);
      this.localeCode = this.pageParams.currentLanguageLocale.slice(3,5);
      this.zendeskLocale = `${this.langCode}-${this.localeCode}`;
      var qordobaLanguageIdObj = this.qordobaProjectActiveLanguages[`${this.langCode}-${this.localeCode}`] || this.qordobaProjectActiveLanguages[this.pageParams.currentLanguageLocale];
      if (qordobaLanguageIdObj && qordobaLanguageIdObj.id) {
        this.qordobaLanguageId = qordobaLanguageIdObj.id;
        this.qordobaLanguageFullName = qordobaLanguageIdObj.fullName;
      }
      else {
        this.client.invoke('notify', 'Error matching languages to Qordoba. Please confirm all languages in Zendesk match a language-locale in Qordoba', 'error', 10000)
      }
    }
    else {
      this.langCode = this.pageParams.currentLanguageLocale.slice(0,2);
      this.localeCode = 'int';
      this.client.invoke('notify', `Found language without locale (${this.pageParams.currentLanguageLocale}). Setting locale to 'int' to match Qordoba.`, 'alert', 10000)
    }
  }


  /*****************API CALLS***********************
  *****************************************************/

  //***********ZENDESK API CALLS***********************

  async getZendeskResourceList() {
    var articleList = await this.client.request({
      type: 'GET',
      dataType: 'json',
      url: `${this.zendeskBaseUrl}/api/v2/help_center/${this.pageType}.json`, 
      cors: true,
      headers: {"Authorization": `Bearer ${this.oAuthToken}`}
    })

    if (this.pageType === 'articles') {
      var parentListResponse = await this.client.request({
        type: 'GET',
        dataType: 'json',
        url: `${this.zendeskBaseUrl}/api/v2/help_center/sections.json`, 
        cors: true,
        headers: {"Authorization": `Bearer ${this.oAuthToken}`}
      })
    }

    else if (this.pageType === 'sections') {
      var parentListResponse = await this.client.request({
        type: 'GET',
        dataType: 'json',
        url: `${this.zendeskBaseUrl}/api/v2/help_center/categories.json`, 
        cors: true,
        headers: {"Authorization": `Bearer ${this.oAuthToken}`}
      })
    }

    if (this.pageType !== 'categories') {
      var parentList = parentListResponse.sections || parentListResponse.categories;

      for (var i = 0; i < parentList.length; i++) {
        var id = parentList[i].id;
        this.zendeskParentResources[id] = {};
        this.zendeskParentResources[id].title = parentList[i].name;
        this.zendeskParentResources[id].description = parentList[i].description;
        this.zendeskParentResources[id].url = parentList[i].html_url;
      }

      if (Object.keys(this.zendeskParentResources).length === 0) {
        if (this.pageType === 'articles') {
          this.client.invoke('notify', 'Error fetching sections. Please make sure all articles belong to sections, and all sections are published.', 'error', 10000)
        }
        else {
          this.client.invoke('notify', 'Error fetching categories. Please make sure all sections belong to categories, and all categories are published.', 'error', 10000)
        }
      }
    }


    var totalPageCount = Math.ceil(articleList.count / Number(this.limit));
    this.pageParams.paginationVisible = true; 
    this.pageParams.prevPageEnabled = this.pageNumber > 1;
    this.pageParams.nextPageEnabled = this.pageNumber < totalPageCount;
    this.pageParams.dataset = [];

  }

  async publishZendeskResources(completeZipFile) {
    this.client.invoke('notify', `Publishing ${this.pageType}.`, 'notice', 10000)
    JSZipUtils.getBinaryContent(`https://app.qordoba.com/api/file/download?token=${completeZipFile.token}&filename=${encodeURIComponent(completeZipFile.filename)}`, async (err, data) => {


      var completedZipDataObj = await newZip.loadAsync(data);
      var completedZipData = completedZipDataObj.files;

      for (var key in completedZipData) {

        var titleArray = key.split('/');
        var resourceArray = titleArray[1].split('__');
        var resourceIdString = resourceArray[1];
        var resourceIdArray = resourceIdString.match(/[0-9]*/);
        var resourceId = resourceIdArray[0];

        if (this.qordobaData[resourceId] && this.qordobaData[resourceId].completed && key.slice(0,5) === `${this.langCode}-${this.localeCode}`) {
          var finalizedZipData = await completedZipData[key].async('text');
          var getTitleRegex = /<div>\s*(.*)\s*<\/div>/;
          var getTitleMatches = getTitleRegex.exec(finalizedZipData);
          var translatedTitle = getTitleMatches[1];
          finalizedZipData = finalizedZipData.replace(getTitleRegex, '');
          if (this.pageType !== 'articles') {
            if (finalizedZipData.length) {
              finalizedZipData = finalizedZipData.replace(/(<([^>]+)>)/ig, '');
              var findTextRegex = /\S[\s, \S]*\S/;
              var textMatch = findTextRegex.exec(finalizedZipData);
              if (textMatch) {
                finalizedZipData = textMatch[0];
              }
              else {
                finalizedZipData = '';
              }
            }
          }
          var translationReq = {
            translation: {
              body: finalizedZipData,
              locale: this.zendeskLocale,
              title: translatedTitle
            }
          }
          if (this.ZendeskResources[resourceId]) {
            try {
              var resourceExists = await this.client.request({
                url: `${this.zendeskBaseUrl}/api/v2/help_center/${this.pageType}/${resourceId}/translations/${this.zendeskLocale}.json`,
                type: 'GET',
                cors: true
              })

              this.client.invoke('notify', `Found existing ${this.pageType}.`, 'alert', 10000)

              if (this.ZendeskResources[resourceId].targetOutdated) {
                this.client.invoke('notify', `Found outdated ${this.pageType}.`, 'alert', 10000)
                try {
                  var zendeskTranslationResponse = await this.client.request({
                    url: `${this.zendeskBaseUrl}/api/v2/help_center/${this.pageType}/${resourceId}/translations/${this.zendeskLocale}.json`,
                    type: 'PUT',
                    data: JSON.stringify(translationReq),
                    contentType: 'application/json',
                    cors: true,
                    headers: {"Authorization": `Bearer ${this.oAuthToken}`}
                  })
                  this.client.invoke('notify', `Outdated ${this.pageType} updated successfuly.`, 'notice', 10000)
                }
                catch(error) {
                  console.log('ERROR UPDATING EXISTING', error)
                  this.client.invoke('notify', `Error updating outdated ${this.pageType}.`, 'error', 10000)
                }
              }
            }

            catch(error) {
              this.client.invoke('notify', `${this.pageType} do not exist. Publishing now.`, 'notify', 10000)
              console.log('resource doesnt exist', error)
              if (error.responseJSON.error === 'TranslationMissing' || error.responseJSON.error === 'RecordNotFound') {
                  var zendeskTranslationResponse = await this.client.request({
                    url: `${this.zendeskBaseUrl}/api/v2/help_center/${this.pageType}/${resourceId}/translations.json`,
                    type: 'POST',
                    data: JSON.stringify(translationReq),
                    contentType: 'application/json',
                    cors: true,
                    headers: {"Authorization": `Bearer ${this.oAuthToken}`}
                  })
                console.log('ZD article created', zendeskTranslationResponse)
                this.client.invoke('notify', `${this.pageType} published successfuly.`, 'notify', 10000)
              }
            }              
          }
        }
      }
      this.pageNumber = 1;
      this.init();
    })
  }



  async getZendeskUser() {
    try {
      return this.client.request({ url: `${this.zendeskBaseUrl}/api/v2/users/me.json`, cors: true })
    }
    catch(err) {
      console.log('ERROR GETTING USER', err)
      this.client.invoke('notify', `Error getting Zendesk user`, 'error', 10000)
    }
  }




  async getAndSetZendeskBrands() {
    try {
      this.pageParams.zendeskBrands = [];
      var currentZendeskBrands = await this.client.request({ url: `/api/v2/brands.json` });
      for (var i = 0; i < currentZendeskBrands.brands.length; i++) {
        if (currentZendeskBrands.brands[i].default) {
          this.currentZendeskBrand = this.currentZendeskBrand || currentZendeskBrands.brands[i].id;
          this.currentZendeskBrandIndex = this.currentZendeskBrandIndex || i + 1;
          this.zendeskBaseUrl = this.zendeskBaseUrl || currentZendeskBrands.brands[i].brand_url;
        }
        this.zendeskBrands[currentZendeskBrands.brands[i].id] = {};
        this.zendeskBrands[currentZendeskBrands.brands[i].id].id = currentZendeskBrands.brands[i].id;
        this.zendeskBrands[currentZendeskBrands.brands[i].id].url = currentZendeskBrands.brands[i].brand_url;
        this.zendeskBrands[currentZendeskBrands.brands[i].id].default = currentZendeskBrands.brands[i].default;
        this.zendeskBrands[currentZendeskBrands.brands[i].id].hasHelpCenter = currentZendeskBrands.brands[i].has_help_center;
        this.zendeskBrands[currentZendeskBrands.brands[i].id].helpCenterState = currentZendeskBrands.brands[i].help_center_state;
        this.zendeskBrands[currentZendeskBrands.brands[i].id].title = currentZendeskBrands.brands[i].name;
        this.pageParams.zendeskBrands.push(this.zendeskBrands[currentZendeskBrands.brands[i].id]);
        if (Object.keys(this.zendeskBrands).length === 0) {
          this.client.invoke('notify', `Error fetching Zendesk brands`, 'error', 10000)
        }
      }
    }
    catch(err) {
      console.log('ERROR GETTING BRANDS', err)
      this.client.invoke('notify', `Error getting Zendesk brands`, 'error', 10000)
    }
  }



  async getZendeskProjectLanguages() {
    try {
      this.localeData = await this.client.request({
        url: `${this.zendeskBaseUrl}/api/v2/help_center/locales.json`,
        type: 'GET',
        cors: true
      })
      this.sourceLocale = this.localeData.default_locale;
    }
    catch(err) {
      console.log('ERROR GETTING Zendesk languages', err)
      this.client.invoke('notify', `Error fetching and setting Zendesk project languages`, 'error', 10000)
    }
  }



  async getZendeskResources() {
    try {
      if (this.zendeskSearchTerm) {
        try {
          var resourcesResponse = await this.client.request({
            url: `${this.zendeskBaseUrl}/api/v2/help_center/${this.pageType}/search.json?page=${this.pageNumber}&per_page=${this.limit}&offset=${this.offset}&sort_by=updated_at&sort_order=desc&query=${this.zendeskSearchTerm}`,
            type: 'GET',
            dataType: 'json',
            cors: true
          });
          var resourcesInSource = resourcesResponse.results;
        }
        catch(err) {
          throw new Error('Error searching:', err)
          this.client.invoke('notify', 'No search results found', 'error', 10000)
          this.zendeskSearchTerm = '';
          this.init();
        }
      }
      else {
        var resourcesResponse = await this.client.request({
          url: `${this.zendeskBaseUrl}/api/v2/help_center/${this.pageType}.json?page=${this.pageNumber}&per_page=${this.limit}&offset=${this.offset}&sort_by=updated_at&sort_order=desc`,
          type: 'GET',
          dataType: 'json',
          cors: true
        });
        var resourcesInSource = resourcesResponse.articles || resourcesResponse.categories || resourcesResponse.sections;
      }


      for (var i = 0; i < resourcesInSource.length; i++) {
        this.ZendeskResources[resourcesInSource[i].id] = {};
        this.ZendeskResources[resourcesInSource[i].id].body = resourcesInSource[i].body;
        this.ZendeskResources[resourcesInSource[i].id].title = resourcesInSource[i].title || resourcesInSource[i].name;
        this.ZendeskResources[resourcesInSource[i].id].createdAt = resourcesInSource[i].created_at;
        this.ZendeskResources[resourcesInSource[i].id].updatedAt = resourcesInSource[i].updated_at;
        this.ZendeskResources[resourcesInSource[i].id].url = resourcesInSource[i].html_url;
        this.ZendeskResources[resourcesInSource[i].id].draft = resourcesInSource[i].draft;
        // this.ZendeskResources[resourcesInSource[i].id].completed = resourcesInSource[i].completed;
        this.ZendeskResources[resourcesInSource[i].id].targetPublished = false;
        this.ZendeskResources[resourcesInSource[i].id].targetOutdated = false;
        if (this.pageType !== 'categories') {
          var parentId = resourcesInSource[i].section_id || resourcesInSource[i].category_id;
          this.ZendeskResources[resourcesInSource[i].id].parent = this.zendeskParentResources[parentId].title;
        }
        if (this.pageType === 'articles') {
          for (var j = 0; j < resourcesInSource[i].outdated_locales.length; j++) {
            var currentOutdatedLanguageLocale = resourcesInSource[i].outdated_locales[j];
            if (currentOutdatedLanguageLocale === this.zendeskLocale) {
              this.ZendeskResources[resourcesInSource[i].id].targetOutdated = true;
            }
          }
        }
      }
    }
    catch(err) {
      console.log('ERROR GETTING Zendesk resources', err)
      this.client.invoke('notify', `Error fetching Zendesk ${this.pageType}`, 'error', 10000)
    }
  }


  async getPublishedZendeskArticles() {
    try {
      var publishedResourcesResponse = await this.client.request({
        type: 'GET',
        dataType: 'json',
        cors: true,
        url: `${this.zendeskBaseUrl}/api/v2/help_center/${this.zendeskLocale}/${this.pageType}.json?page=${this.pageNumber}&per_page=${this.limit}&offset=${this.offset}&sort_by=updated_at&sort_order=desc`,
        headers: {"Authorization": `Bearer ${this.oAuthToken}`}
      })
      var publishedResources = publishedResourcesResponse.articles || publishedResourcesResponse.categories || publishedResourcesResponse.sections;
      for (var j = 0; j < publishedResources.length; j++) {
        var currentId = publishedResources[j].id;
        this.ZendeskResources[currentId].targetPublished = true;
      }
    }
    catch(err) {
      console.log('FOUND NO PUBLISHED RESOURCES FOR THIS LOCALE')
      this.client.invoke('notify', `Found no published ${this.pageType} for this locale`, 'alert', 10000)
    }
  }


  async setZendeskPageParams() {

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
          if (!this.pageParams.currentLanguageLocale) {
            this.pageParams.currentLanguageLocale = zendeskLocale;
          }
          this.pageParams.activeLanguages.push(pageLangObj);
        }
        if (!foundMatchInQProj) {
          //no match
          this.client.invoke('notify', `Found no match for language code "${this.localeData.locales[i]}" in Qordoba project.`, 'alert', 10000)
          var pageLangObj = {name: zendeskLocale, fullName: `${zendeskLocale} (no match)`, zendeskLocale: zendeskLocale, selected: false};
          this.pageParams.zendeskLocalesNotPartOfQordobaProject = [];
          this.pageParams.zendeskLocalesNotPartOfQordobaProject.push(pageLangObj)
        }
      }
    }
  }

  //************QORDOBA API CALLS***********************

  async processQordobaCredentials() {
    try {
      var userSettingsResponse = await this.client.metadata();
      this.userSettings = userSettingsResponse.settings;
      this.qordobaOrganization = this.userSettings['Qordoba Organization Id'];
      this.qordobaProjectId = this.userSettings['Qordoba Project Id'];
      this.qordobaAuthToken = this.userSettings['Qordoba X-Auth Token'];
    }
    catch(err) {
      console.log(`Error processing Qordoba credentials.`, err)
      this.client.invoke('notify', `Error processing Qordoba credentials.`, 'error', 10000)
    }
  }



  async getQordobaProjectLanguages() {
    try {
      var projectDetailCall = await $.ajax({
        type: 'GET',
        url: `https://app.qordoba.com/api/organizations/${this.qordobaOrganization}/projects?limit=1&offset=0&limit_to_projects=${this.qordobaProjectId}`,
        headers: this.jsonReqHeader
      })
      var projectTargetLanguageObjectArray = projectDetailCall.projects[0].target_languages;
      for (var i = 0; i < projectTargetLanguageObjectArray.length; i++) {
        this.qordobaProjectActiveLanguages[projectTargetLanguageObjectArray[i].code] = {};
        this.qordobaProjectActiveLanguages[projectTargetLanguageObjectArray[i].code].id = projectTargetLanguageObjectArray[i].id;
        this.qordobaProjectActiveLanguages[projectTargetLanguageObjectArray[i].code].name = projectTargetLanguageObjectArray[i].code;
        this.qordobaProjectActiveLanguages[projectTargetLanguageObjectArray[i].code].fullName = projectTargetLanguageObjectArray[i].name;
      }
    }
    catch(err) {
      this.client.invoke('notify', `Error retrieving Qordoba languages.`, 'error', 10000)
    }
  }


  async getQordobaResources() {
    try {
      for (var key in this.ZendeskResources) {
        var qordobaResponse = await $.ajax({
          type: 'POST',
          url: `https://app.qordoba.com/api/projects/${this.qordobaProjectId}/languages/${this.qordobaLanguageId}/page_settings/search?limit=${this.limit}&offset=${this.offset}`,
          headers: this.jsonReqHeader,
          data: JSON.stringify({title: key})
        })
        if (qordobaResponse.pages.length === 1) {
          var urlWithoutHtml = qordobaResponse.pages[0].url.replace('.html', '');
          var urlWithoutHtmlArray = urlWithoutHtml.split('__');
          var resourceName = urlWithoutHtmlArray[0];
          var resourceIdArray = urlWithoutHtmlArray[1].split(' ');
          var resourceId = resourceIdArray[0];
          this.qordobaData[resourceId] = {};
          this.qordobaData[resourceId].enabled = qordobaResponse.pages[0].enabled;
          this.qordobaData[resourceId].completed = qordobaResponse.pages[0].completed;
          this.qordobaData[resourceId].qordobaPageId = qordobaResponse.pages[0].page_id;
          this.qordobaData[resourceId].lastUpdatedAt = qordobaResponse.pages[0].update;
          this.qordobaData[resourceId].title = resourceName;
        }
        else if (qordobaResponse.pages.length > 1) {
          this.client.invoke('notify', `Found multiple matches for this page in Qordoba. Please check your Qordoba project and confirm any duplicates.`, 'error', 10000)
          throw new Error('Found multiple matches for this page in Qordoba. Please check your Qordoba project and confirm any duplicates')
        }
      }
    }
    catch(err) {
      this.client.invoke('notify', `Error retrieving Qordoba ${this.pageType}.`, 'error', 10000)
    }
  }



  async getFileDetailFromQordoba() {
    try {
      this.view.switchTo('loading');
      var pageIdArray = [];
      for (var key in this.filesToProcess) {
        pageIdArray.push(this.qordobaData[key].qordobaPageId);
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
      await this.publishZendeskResources(completeZipFile); //TODO move so we dont call from in here
    }
    catch(err) {
      throw new Error ('error downloading files', err)
      this.client.invoke('notify', `Error downloading files from Qordoba.`, 'error', 10000);
    }
  }



  async sendResourcesToQordoba() {
    this.view.switchTo('loading');

    var filesToUpload = [];

    for (var key in this.filesToProcess) {
      try {
        await this.getZendeskResourceDetail(this.filesToProcess[key].title, key);
        var fileToUpload = new File([this.filesToProcess[key].file], `${this.filesToProcess[key].title}__${key} (${this.ZendeskResources[key].parent}).html`, {
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
        filesToUpload.push(qordobaSendFilesRequest);
      }
      catch(err) {
        this.client.invoke('notify', `Error uploading ${key}.`, 'error', 10000);
      }
    }

    var randomKey = Object.keys(this.filesToProcess)[0];

    if (this.filesToProcess[randomKey].targetExists) {
      this.client.invoke('notify', `Found existing file in Qordoba. Updating...`, 'notice', 10000);
      qordobaSendFilesRequest.url = `https://app.qordoba.com/api/projects/${this.qordobaProjectId}/files/${this.qordobaData[key].qordobaPageId}/update/upload`;
      var qordobaSendFilesResponse = await $.ajax(qordobaSendFilesRequest);
      try {
        var responseToFilesUpdated = await $.ajax({
          type: 'PUT',
          url: `https://app.qordoba.com/api/projects/${this.qordobaProjectId}/files/${this.qordobaData[key].qordobaPageId}/update/apply`,
          data: JSON.stringify({
            new_file_id: qordobaSendFilesResponse.id,
            keep_in_project: false
          }),
          headers: {
            'X-AUTH-TOKEN': this.qordobaAuthToken,
            'Content-Type': 'application/json'
          }
        })
        this.client.invoke('notify', `Qordoba file updated successfuly.`, 'notice', 10000);
      }
      catch(err) {
        this.client.invoke('notify', `Error updating existing file in Qordoba`, 'error', 10000);
      }
    } else {
      var appendFilesData = [];
      this.client.invoke('notify', `No matching files found in Qordoba. Uploading new files.`, 'notice', 10000);
      for (var i = 0; i < filesToUpload.length; i++) {
        filesToUpload[i].url = `https://app.qordoba.com/api/organizations/${this.qordobaOrganization}/upload/uploadFile_anyType?content_type_code=stringsHtml&projectId=${this.qordobaProjectId}`;
        var qordobaSendFilesResponse = await $.ajax(filesToUpload[i]);
        var appendFileObject = {content_type_codes: [{name: "Html String", content_type_code: "stringsHtml", extensions: ["html"]}],file_name: qordobaSendFilesResponse.file_name,id: qordobaSendFilesResponse.upload_id,source_columns: [],version_tag: ""};
        appendFilesData.push(appendFileObject);
      }
      try {
        var responseToFilesUploaded = await $.ajax({
          type: 'POST',
          url: `https://app.qordoba.com/api/projects/${this.qordobaProjectId}/append_files`,
          data: JSON.stringify(appendFilesData),
          headers: {
            'X-AUTH-TOKEN': this.qordobaAuthToken,
            'Content-Type': 'application/json'
          }
        })
        this.client.invoke('notify', `Files uploaded successfuly`, 'notice', 10000);
      }
      catch(err) {
        this.client.invoke('notify', `Error uploading new files to Qordoba`, 'error', 10000);
      }
    }
    this.init();
  }

  getZendeskResourceDetail(resourceName, resourceId) {
    try {
      return this.client.request({url: `${this.zendeskBaseUrl}/api/v2/help_center/${this.pageType}/${resourceId}.json`, cors: true})
      .then((resourceData) => {
        this.filesToProcess[resourceId].project_id = this.qordobaProjectId;
        this.filesToProcess[resourceId].file_names = resourceName;
        if (this.pageType === 'articles') {
          var title = resourceData.article.title;
          var titleNode = `<div>${title}</div>`
          this.filesToProcess[resourceId].url = resourceData.article.html_url;
          this.filesToProcess[resourceId].file = titleNode + resourceData.article.body;
        }
        else if (this.pageType === 'categories') {
          var title = resourceData.category.name;
          var titleNode = `<div>${title}</div>`
          this.filesToProcess[resourceId].url = resourceData.category.html_url;
          this.filesToProcess[resourceId].file = titleNode + resourceData.category.description;
        }
        else if (this.pageType === 'sections') {
          var title = resourceData.section.name;
          var titleNode = `<div>${title}</div>`
          this.filesToProcess[resourceId].url = resourceData.section.html_url;
          this.filesToProcess[resourceId].file = titleNode + resourceData.section.description;
        }
        else {
          throw new Error('No valid page type found');
        }
      })
    }
    catch(err) {
      throw new Error(`Error getting Zendesk resource detail for ${resourceName}`)
      this.client.invoke('notify', `Error getting Zendesk resource detail for ${resourceName}`, 'error', 10000);
    }
  }

  /*****************UTILITIES***********************
  *****************************************************/

  //************UI UTILITIES***********************
  

  //incomplete
  async setIndividualResourceStatus(listRowElement, resourceName, resourceId) {
    try {
      var allResourceCheckboxes = document.querySelectorAll('input.js-checkbox');
      var resourceStatusCheckingSpan = listRowElement.children[0].children[0].children[4].children[0];
      resourceStatusCheckingSpan.dataset.resourceName = resourceName;
      var resourceStatusCompletedSpan = listRowElement.children[0].children[0].children[4].children[1];
      resourceStatusCompletedSpan.dataset.resourceName = resourceName;
      var resourceStatusNotExistSpan = listRowElement.children[0].children[0].children[4].children[2];
      resourceStatusNotExistSpan.dataset.resourceName = resourceName;
      var resourceStatusInProgressSpan = listRowElement.children[0].children[0].children[4].children[3];
      resourceStatusInProgressSpan.dataset.resourceName = resourceName;
      var resourceStatusErrorSpan = listRowElement.children[0].children[0].children[4].children[4];
      resourceStatusErrorSpan.dataset.resourceName = resourceName;
      var resourceCheckBox = listRowElement.children[0].children[0].children[0].children[0].children[0].children[0];
      resourceCheckBox.dataset.resourceName = resourceName;
      var resourceLink = listRowElement.children[0].children[0].children[2].children[1];
      // var selectAllCheckbox = document.querySelector('.js-select-all');

      resourceCheckBox.addEventListener('click', (e) => {
        var uploadButton = document.querySelector('.js-batch-upload');
        var publishButton = document.querySelector('.js-publish');
        var publishButtonEnabled = true;
        var uploadButtonEnabled = true;
        if (e.target.checked) { 
          this.filesToProcess[resourceId] = {};
          this.filesToProcess[resourceId].title = e.target.dataset.resourceName //really needs to be the ID of the article im going to send to Qordoba
          this.filesToProcess[resourceId].sourcePublished = JSON.parse(listRowElement.dataset.sourcePublished);
          this.filesToProcess[resourceId].targetCompleted = JSON.parse(listRowElement.dataset.targetCompleted);
          this.filesToProcess[resourceId].targetExists = JSON.parse(listRowElement.dataset.targetExists);
          this.filesToProcess[resourceId].targetPublished = JSON.parse(listRowElement.dataset.targetPublished);
          this.filesToProcess[resourceId].targetOutdated = JSON.parse(listRowElement.dataset.targetOutdated);

      

          //Set checkbox statuses
          for (var i = 0; i < allResourceCheckboxes.length; i++) {
            var pageTypeAndId = allResourceCheckboxes[i].id;
            var id = pageTypeAndId.split('-')[1];
            if (!this.filesToProcess[resourceId].targetExists) {
              if (this.qordobaData[id] && allResourceCheckboxes[i] !== e.target) {
                allResourceCheckboxes[i].disabled = true;
              }
            }
            else {
              if (this.filesToProcess[resourceId].targetCompleted) {
                if (this.filesToProcess[resourceId].targetPublished && !this.filesToProcess[resourceId].targetOutdated) {
                  publishButtonEnabled = false;
                  if (allResourceCheckboxes[i] !== e.target) {
                    allResourceCheckboxes[i].disabled = true;
                  }
                }
                else {
                  // selectAllCheckbox.disabled = true;
                  if (allResourceCheckboxes[i] !== e.target && (!this.qordobaData[id] || !this.qordobaData[id].completed || this.ZendeskResources[id].targetPublished)) {
                    allResourceCheckboxes[i].disabled = true;
                    if (Object.keys(this.filesToProcess).length > 1) {
                      uploadButtonEnabled = false;
                    }
                  }
                }
              }
              else {
                if (allResourceCheckboxes[i] !== e.target) {
                  allResourceCheckboxes[i].disabled = true;
                }
              }
            }
          }

          //Publish/upload button statuses
          if (this.filesToProcess[resourceId].targetCompleted) {
            this.filesReadyToPublish++;
          }

        } else {
          
          for (var i = 0; i < allResourceCheckboxes.length; i++) {
            var pageTypeAndId = allResourceCheckboxes[i].id;
            var id = pageTypeAndId.split('-')[1];
            if (!this.filesToProcess[resourceId].targetExists) {
              if (allResourceCheckboxes[i] !== e.target && this.qordobaData[id] && Object.keys(this.filesToProcess).length === 1) {
                allResourceCheckboxes[i].disabled = false;
              }
            }
            else {
              if (this.filesToProcess[resourceId].targetCompleted) {
                if (this.filesToProcess[resourceId].targetPublished || !this.filesToProcess[resourceId].sourcePublished) {
                  publishButtonEnabled = true;
                  if (allResourceCheckboxes[i] !== e.target) {
                    allResourceCheckboxes[i].disabled = false;
                  }
                }
                else {
                  // selectAllCheckbox.disabled = true;
                  if (Object.keys(this.filesToProcess).length <= 1 && allResourceCheckboxes[i] !== e.target && (!this.qordobaData[id] || !this.qordobaData[id].completed || this.ZendeskResources[id].targetPublished || this.ZendeskResources[id].draft)) {
                    allResourceCheckboxes[i].disabled = false;
                    uploadButtonEnabled = true;
                  }
                }
              }
              else {
                if (allResourceCheckboxes[i] !== e.target) {
                  allResourceCheckboxes[i].disabled = false;
                }
              }
            }
          }
          if (this.filesToProcess[resourceId].targetCompleted) {
            this.filesReadyToPublish--;
          }
          delete this.filesToProcess[resourceId];
          if (Object.keys(this.filesToProcess).length === 0) {
            // uploadButton.classList.add('is-disabled');
            uploadButtonEnabled = false;
          }  
        }
        if (this.filesReadyToPublish > 1 || !uploadButtonEnabled) {
          uploadButton.classList.add('is-disabled');
        }
        else {
          uploadButton.classList.remove('is-disabled');
        }
        if (this.filesReadyToPublish > 0 && publishButtonEnabled) {
          publishButton.classList.remove('is-disabled');
        }
        else {
          publishButton.classList.add('is-disabled');
        } 
      });


      if (!this.qordobaData[resourceId]) {
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

      else if (this.qordobaData[resourceId].completed && this.qordobaData[resourceId].enabled) {
        // resourceLink.href = this.ZendeskResources[resourceId].url.replace(this.sourceLocale, this.zendeskLocale);
        resourceLink.disabled = false;
        resourceStatusCompletedSpan.classList.remove('is-hidden');
        resourceStatusNotExistSpan.classList.add('is-hidden');
        resourceStatusCheckingSpan.classList.add('is-hidden');
        resourceCheckBox.checked = false;
        resourceCheckBox.disabled = false;
        resourceCheckBox.classList.add('js-can-upload');
      }

      else if (this.qordobaData[resourceId].enabled) {
        resourceLink.disabled = true;
        resourceStatusInProgressSpan.classList.remove('is-hidden');
        resourceStatusNotExistSpan.classList.add('is-hidden');
        resourceStatusCheckingSpan.classList.add('is-hidden');
        resourceCheckBox.checked = false;
        resourceCheckBox.disabled = false;
        resourceCheckBox.classList.add('js-can-upload');
      }

      if (this.ZendeskResources[resourceId].targetOutdated) {
        //Add error block from row
        resourceStatusErrorSpan.classList.remove('is-hidden');
        resourceStatusErrorSpan.classList.add('o-badge');
        resourceStatusErrorSpan.style.backgroundColor = 'red'
        resourceStatusErrorSpan.innerHTML = 'OUTDATED';
        resourceCheckBox.disabled = false;
      }
      else {
        //hide error block from row
        resourceStatusErrorSpan.classList.add('is-hidden');
      }
    }
    catch(err) {
      this.client.invoke('notify', `Error setting row status for ${resourceName}`, 'error', 10000)
      throw new Error(`Error setting row status for ${listRowElement}`, err)
    }
  }

  //Need to break this apart
  async setAllResourceAndDomNodeStauses() {

    try {
      //Need to update UI to mark anything existing in this.zendeskLocalesNotPartOfQordobaProject //TODO
      var pageTypeNodes = document.querySelectorAll('.o-tabs__item');
      var uploadButton = document.querySelector('.js-batch-upload');
      var publishButton = document.querySelector('.js-publish');
      var targetLangNotSelectedRow = document.querySelector('[data-value="Active Locales"]');
      var otherLocaleLinks = document.querySelectorAll('[data-function="lang"]');
      var localeDropdown = document.querySelector('select.dropdown-toggle.active-locales');
      var brandDropdown = document.querySelector('select.dropdown-toggle.q-brand-dropdown');
      var nextPageButton = document.querySelector('.js-goto-next');
      var prevPageButton = document.querySelector('.js-goto-prev');
      var refreshButton = document.querySelector('a.js-refresh');
      // var selectAllCheckbox = document.querySelector('.js-select-all');
      var resourceCheckBoxArray = document.querySelectorAll('input.js-checkbox');
      var searchForm = document.querySelector('form.q-search-form');
      var searchInput = document.querySelector('input.o-inputwith-icon__input.o-textinput');
      var clearSearchButton = document.querySelector('a.o-inputwith-icon__action.js-articles.js-clear-search');

      // selectAllCheckbox.addEventListener('click', (e) => {
      //   for (var i = 0; i < resourceCheckBoxArray.length; i++) {
      //     if (resourceCheckBoxArray[i] !== selectAllCheckbox) {
      //       if (resourceCheckBoxArray[i].checked !== selectAllCheckbox.checked) {
      //         resourceCheckBoxArray[i].click();
      //       }
      //     }
      //   }
      // });

      searchForm.addEventListener('submit',(e) => {
        e.preventDefault();
        this.view.switchTo('loading');
        this.zendeskSearchTerm = searchInput.value;
        this.pageNumber = 1;
        this.init();
      });

      clearSearchButton.addEventListener('click', (e) => {
        this.view.switchTo('loading');
        this.zendeskSearchTerm = '';
        this.pageNumber = 1;
        this.init();
      });

      for (var i = 0; i < pageTypeNodes.length; i++) {
        pageTypeNodes[i].addEventListener('click', (e) => {
          this.view.switchTo('loading');
          this.pageNumber = 1;
          this.pageType = e.target.innerText.toLowerCase();
          this.zendeskSearchTerm = '';
          this.init();
        });
      }

      refreshButton.addEventListener('click', (e) => {
        this.view.switchTo('loading');
        this.init();
      });

      publishButton.addEventListener('click', (e) => {
        this.getFileDetailFromQordoba();
      });

      brandDropdown.options.selectedIndex = this.currentZendeskBrandIndex;
      brandDropdown.addEventListener('change', (e) => {
        var targetRow = e.target.querySelector(`option[data-value="${e.target.value}"]`)
        this.pageParams.currentZendeskBrand = e.target.value;
        this.currentZendeskBrand = e.target.value;
        this.currentZendeskBrandIndex = e.target.selectedIndex;
        this.zendeskBaseUrl = this.zendeskBrands[this.pageParams.currentZendeskBrand].url;
        this.view.switchTo('loading');
        this.init();
      });


      localeDropdown.options.selectedIndex = this.dropdownIndexForTargetLanguage
      localeDropdown.classList.add('selected-locale');
      localeDropdown.addEventListener('change', (e) => {
        var targetRow = e.target.querySelector(`option.${e.target.value}`)
        this.pageParams.currentLanguageLocale = e.target.value;
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

      uploadButton.addEventListener('click', (e) => {
        this.sendResourcesToQordoba(); 
      });

      for (var key in this.ZendeskResources) {
        var listRowElement = document.querySelector(`[data-resource="${this.pageParams.page}-${key}"]`);
        listRowElement.dataset.resourceName = this.ZendeskResources[key].title;
        listRowElement.dataset.sourcePublished = !this.ZendeskResources[key].draft || false;
        listRowElement.dataset.targetCompleted = this.qordobaData[key] && this.qordobaData[key].completed && this.qordobaData[key].enabled || false;
        listRowElement.dataset.targetExists = this.qordobaData[key] && this.qordobaData[key].enabled || false;
        listRowElement.dataset.targetPublished = this.ZendeskResources[key].targetPublished;
        listRowElement.dataset.targetOutdated = this.ZendeskResources[key].targetOutdated;
        this.setIndividualResourceStatus(listRowElement, listRowElement.dataset.resourceName, key);
      }
    }
    catch(err) {
      this.client.invoke('notify', 'Error setting page statuses', 'error', 10000)
      throw new Error('Error setting page statuses', err)
    }
  }


  //************ZENDESK UTILITIES***********************

  reconstructZendeskResourcesObject(dataObject, key) {
    var qordobaPublished = this.qordobaData[key] || {completed: false};
    var targetUrl = dataObject.url.replace(this.sourceLocale, this.zendeskLocale);
    var sourceAdminUrl = `${this.client._origin}/knowledge/${this.pageType}/${key}/${this.sourceLocale}?brand_id=${this.currentZendeskBrand}`;
    var targetAdminUrl = `${this.client._origin}/knowledge/${this.pageType}/${key}/${this.zendeskLocale}?brand_id=${this.currentZendeskBrand}`;
    if (this.pageType !== 'categories') {
      var titleString = `${dataObject.title} (${dataObject.parent})`;
    } 
    else {
      var titleString = `${dataObject.title}`;
    }
    return {
      name: `${this.pageParams.page}-${key}`,
      title_string: titleString,
      zd_object_updated: moment(dataObject.updatedAt).format('MMM D YYYY h:mma'),
      source_url : dataObject.url,
      source_url_admin: sourceAdminUrl,
      zd_outdated: false,
      source_published: !dataObject.draft,
      target_completed: qordobaPublished.completed,
      target_published: dataObject.targetPublished,
      fullName: this.qordobaLanguageFullName,
      target_url: targetUrl,
      target_url_admin: targetAdminUrl,
    }
  }

  async renderZendeskSyncPage() {
    try {
      for (var key in this.ZendeskResources) {
        var constructedObject = this.reconstructZendeskResourcesObject(this.ZendeskResources[key], key);
        this.pageParams.dataset.push(constructedObject);
      }
      return this.view.switchTo('QordobaHome', this.pageParams);
    }
    catch(err) {
      this.client.invoke('notify', 'Error rendering sync page.', 'error', 10000)
      throw new Error('Error rendering sync page.', err)
    }
  }
}

export default NavBar;