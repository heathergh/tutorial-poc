`
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require("uuid");
const { mockDb } = require("./utils/mock-db");

const Nylas = require('nylas');
const { WebhookTriggers } = require('nylas/lib/models/webhook');
const { Scope } = require('nylas/lib/models/connect');
const { ServerBindings } = require('nylas/lib/config');

// The port the express app will run on
const port = 9000;

// The uri for the frontend
const clientUri = 'http://localhost:3000';

// Nylas application credentials
const clientId = 'YOUR_APP_CLIENT_ID';
const clientSecret = 'YOUR_APP_CLIENT_SECRET';

// Utility function for pretty-printing JSONs :)
const prettyPrintJSON = (json) => {
    return JSON.stringify(json, undefined, 2);
}

// Initialize an instance of the Nylas SDK using the client credentials
const nylasClient = new Nylas({
    clientId: clientId,
    clientSecret: clientSecret,
});

// Before we start our backend, we should whitelist our frontend as a redirect URI to ensure the auth completes
nylasClient.application({
    redirectUris: [
        clientUri
    ]
}).then(applicationDetails => {
    console.log("Application whitelisted. Application Details: ", prettyPrintJSON(applicationDetails));
    startExpress();
});

const exchangeMailboxTokenCallback = async (accessTokenObj, res) => {
    // Normally store the access token in the DB
    const accessToken = accessTokenObj.accessToken
    const emailAddress = accessTokenObj.emailAddress
    console.log(
        'Access Token was generated for: ' + accessTokenObj.emailAddress
    )
    let user = await mockDb.findUser(emailAddress)
    if (user) {
        user = await mockDb.updateUser(user.id, { accessToken })
    } else {
        user = await mockDb.createUser({
            accessToken,
            emailAddress,
        })
    }

    res.json({
        id: user.id,
        emailAddress: user.emailAddress,
    });
}

const startExpress = () => {
    const app = express();

    // Enable CORS
    app.use(cors())

    // Use the express bindings provided by the SDK and pass in additional configuration such as auth scopes
    const expressBinding = new ServerBindings.express(nylasClient, {
        defaultScopes: [
            Scope.EmailModify,
            Scope.EmailSend,
        ],
        exchangeMailboxTokenCallback,
        clientUri,
    });

    // Handle when an account gets connected
    expressBinding.on(WebhookTriggers.AccountConnected, (payload) => {
        console.log("Webhook trigger received, account connected. Details: ", prettyPrintJSON(payload.objectData));
    });

    // Mount the express middleware to your express app
    const nylasMiddleware = expressBinding.buildMiddleware();
    app.use('/nylas', nylasMiddleware);

    // Start the Nylas webhook
    expressBinding.startDevelopmentWebsocket()
        .then(webhookDetails => console.log('Webhook tunnel registered. Webhook ID: ' + webhookDetails.id));

    // Add some routes for the backend
    app.get('/', (req, res) => res.status(200).send('Ok'));

    // Add route for getting 5 latest emails
    app.get('/nylas/read-emails', async (req, res) => {
        if (!req.headers.authorization) {
            return res.json("Unauthorized");
        }

        const user = await mockDb.findUser(req.headers.authorization);
        if (!user) {
            return res.json("Unauthorized");
        }

        const messages = await nylasClient
            .with(user.accessToken)
            .messages.list({ limit: 5 });
        return res.json(messages);
    });

    // Start listening on port 9000
    app.listen(port, () => console.log('App listening on port ' + port));
}`