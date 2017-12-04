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
