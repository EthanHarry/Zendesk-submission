var express = require('express');
var app = express();
var path = require('path');
var bodyParser = require('body-parser');
var axios = require('axios');
var cookieParser = require('cookie-parser');
var handlebars = require('handlebars');
var postMessageTemplate = `<script type="text/javascript">window.parent.postMessage({zendeskAuthToken: '{{zendeskAuthToken}}'}, '*');</script>`;
var template = handlebars.compile(postMessageTemplate);

// app.use(express.static('public'));
app.use(bodyParser.json());
app.use(cookieParser());



//new handle decision
/**
 * Responds to any HTTP request that can provide a "message" field in the body.
 *
 * @param {!Object} req Cloud Function request context.
 * @param {!Object} res Cloud Function response context.
 */

var axios = require('axios');
var cookieParser = require('cookie-parser');
var cookieParserWrapper = cookieParser();
var handleDecision = function(req, res) {
  console.log('hit handle descision endpoint')
  var authCode = req.query.code;
  console.log('authCode', authCode)
  
  axios.get(`https://ethanhelp.zendesk.com/api/v2/oauth/clients.json`)
  .then((clientResponse) => {
    var oAuthClients = clientResponse.clients;
    for (var i = 0; i < oAuthClients.length; i++) {
      if (oAuthClients[i].company === 'Qordoba') {
        var clientId = oAuthClients[i].identifier;
        var clientSecret = oAuthClients[i].secret;
        break;
      }
    }
    axios.post(`https://ethanhelp.zendesk.com/oauth/tokens`, {
      grant_type: 'authorization_code',
      code: authCode,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `https://us-central1-qordoba-devel.cloudfunctions.net/qordoba-zendesk-handle_decision`,
      scope: 'read'
    })
      .then((response) => {
      //redirecting back to our app
      console.log('response data', response.data)
      console.log('zendeskAuthToken', response.data.access_token)
      var accessToken = response.data.access_token;
      res.cookie('zendeskAuthToken', accessToken);
      res.redirect(`https://ethanhelp.zendesk.com/agent/apps/qordoba?zat=true`);
    })
      .catch((error) => {
      console.log('error FROM GETTING TOKEN', error)
    })
  })
}

exports.handle_decision = function handle_decision(req, res) {
  cookieParserWrapper(req, res, function() {
    handleDecision(req, res)
  })
};






//old handle decision

/**
 * Responds to any HTTP request that can provide a "message" field in the body.
 *
 * @param {!Object} req Cloud Function request context.
 * @param {!Object} res Cloud Function response context.
 */

/**
 * Responds to any HTTP request that can provide a "message" field in the body.
 *
 * @param {!Object} req Cloud Function request context.
 * @param {!Object} res Cloud Function response context.
 */

var axios = require('axios');
var cookieParser = require('cookie-parser');
var cookieParserWrapper = cookieParser();
var handleDecision = function(req, res) {
  console.log('hit handle descision endpoint')
  var authCode = req.query.code;
  console.log('authCode', authCode)
  
  axios.get(`https://ethanhelp.zendesk.com/api/v2/oauth/clients.json`)

    console.log('CLIENT CALL', test)
    var oAuthClients = test.clients;
    for (var i = 0; i < oAuthClients.length; i++) {
      if (oAuthClients[i].company === 'Qordoba') {
        var clientId = oAuthClients[i].identifier;
        var clientSecret = oAuthClients[i].secret;
      }
    }
  
  axios.post(`https://ethanhelp.zendesk.com/oauth/tokens`, {
    grant_type: 'authorization_code',
    code: authCode,
    client_id: 'qordoba_integration_for_zendesk',
    client_secret: 'f33f29d8ace46ff8b4b5b5a9dc1c6f39ef090d7a172207669ec73e3317eeaedb',
    redirect_uri: `https://us-central1-qordoba-devel.cloudfunctions.net/qordoba-zendesk-handle_decision`,
    scope: 'read'
  })
  .then((response) => {
    //redirecting back to our app
    console.log('response data', response.data)
        console.log('zendeskAuthToken', response.data.access_token)
    var accessToken = response.data.access_token;
    res.cookie('zendeskAuthToken', accessToken);
    res.redirect(`https://ethanhelp.zendesk.com/agent/apps/qordoba?zat=true`);
  })
  .catch((error) => {
    console.log('error FROM GETTING TOKEN', error)
  })
}

exports.handle_decision = function handle_decision(req, res) {
  cookieParserWrapper(req, res, function() {
    handleDecision(req, res)
  })
};





// app.get('/zendesk_auth', (req,res) => {
//   console.log('request at zendesk_auth', req.query)
//   res.redirect(`https://ethanhelp.zendesk.com/oauth/authorizations/new?response_type=code&redirect_uri=http://localhost:3000/handle_decision&client_id=qordoba_integration_for_zendesk&scope=hc:read%20write`)
// })

// app.get('/handle_decision', (req, res) => {
//   console.log('hit handle descision endpoint')
//   var authCode = req.query.code;
//   console.log('authCode', authCode)

//   axios.post(`https://ethanhelp.zendesk.com/oauth/tokens`, {
//     grant_type: 'authorization_code',
//     code: authCode,
//     client_id: 'qordoba_integration_for_zendesk',
//     client_secret: 'f33f29d8ace46ff8b4b5b5a9dc1c6f39ef090d7a172207669ec73e3317eeaedb',
//     redirect_uri: `http://localhost:3000/handle_decision`, //need to eliminate hard coding
//     scope: 'read'
//   })
//   .then((response) => {
//     console.log('RESULT FROM GETTING TOKEN', response.data)
//     var accessToken = response.data.access_token;
//     res.cookie('zendeskAuthToken', accessToken);
//     console.log('redirecting back to our app!')
//     res.redirect(`https://ethanhelp.zendesk.com/agent/apps/qordoba?zat=true`);
//     // res.send(200)
//   })
//   .catch((error) => {
//     console.log('error FROM GETTING TOKEN', error)
//     res.cookie('zendeskAuthToken', undefined);
//     // res.redirect()
//   })
//   .then((result) => {
//     console.log('RESULT of getting token from server to web app', result)
//     console.log('CURRENT COOKIES', document.cookie)
//     var token = document.cookie.replace(/(?:(?:^|.*;\s*)zendeskAuthToken\s*\=\s*([^;]*).*$)|^.*$/, "$1");
//     console.log('TOKEN ON WEB APP', token)
//     console.log('parent', window.parent)
//     window.parent.postMessage({token: token}, '*');
//   })
// })

// app.get('/user_token', (req, res) => {
//   accessToken = req.cookies.zendeskAuthToken;
//   refreshToken = req.cookies.zendeskRefreshToken;
//   if (accessToken) {
//     //send back access token
//     res.cookie('zendeskAuthToken', accessToken);
//     // res.send(200);
//     var tokenData = {zendeskAuthToken: accessToken}
//     var templateToSend = template(tokenData);
//     console.log('SENDING TEMPLATE', templateToSend)
//     res.send(templateToSend);
//   }
//   else if (refreshToken) {
//     //get access token again using refr
//     console.log('access token from client', accessToken)
//   }
//   else {
//     //send back undefined to kick off auth flow
//     res.send(template({zendeskAuthToken: 'undefined'}))
//   }
// })

app.listen(3000, () => {
  console.log('app listening on 3000')
})


// axios.post(`https://ethanhelp.zendesk.com/oauth/tokens`, {
//     grant_type: 'authorization_code',
//     code: authCode,
//     client_id: 'qordoba_integration_for_zendesk',
//     client_secret: 'f33f29d8ace46ff8b4b5b5a9dc1c6f39ef090d7a172207669ec73e3317eeaedb',
//     redirect_uri: `http://localhost:3000`, //need to eliminate hard coding
//     scope: 'read'
//   })
  // .then((result) => {
  //   console.log('RESULT FROM GETTING TOKEN', result)
  // })