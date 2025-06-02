// index.js

const { App } = require('@slack/bolt');
const axios = require('axios');
require('dotenv').config();

// When we detect a message with one or more swarm-backed CLs in it...
const ShareMethod = {
    POST_IN_CHANNEL: 0, // ...post the hyperlinks to the associated swarm reviews in the channel.
    POST_IN_THREAD: 1,  // ...post the hyperlinks to the associated swarm reviews in a thread of the message.
    EDIT_MESSAGE: 2     // ...edit the user's message, changing the CL references into hyperlinks to the associated swarm reviews.
};

// These variables configure the behavior of the script.
const useSocketMode = true;
const shouldCheckURLValid = true;
const shouldCheckSwarmExists = false;
const shareMethod = ShareMethod.POST_IN_THREAD;

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: useSocketMode,
    appToken: useSocketMode ? process.env.SLACK_APP_TOKEN : null
});

const swarmURLPrefix = 'https://swarm.p4.eve.games/changes/';

var checkURL = async function(url) {
    try {
        let response = await fetch(url);
        return response.status !== 404;
    } catch(error) {
        console.error('Error checking URL: ' + url);
        console.error('Error: ' + error);
        return false;
    }
};

var checkSwarmReviewExists = async function(changeListNumber) {
    try {
        // See: https://axios-http.com/docs/req_config
        // See: https://help.perforce.com/helix-core/helix-swarm/swarm/2024.6/Content/Swarm/swarm-api-endpoint-reviews.html#Reviews__Swarm_reviews
        let response = await axios.get(`https://swarm.p4.eve.games/api/v11/reviews`, {
            auth: {
                username: process.env.P4_USER_NAME,
                password: process.env.P4_USER_TICKET        // Use command: p4 tickets
            },
            params: {
                keywords: `${changeListNumber}`,
                'keywordFields[]': 'changes',
                'fields[]': 'id'
            }
        });
        try {
            let review = response.data.data.reviews[0];
            return review.id == changeListNumber;
        } catch(error) {
            return false;
        }
    } catch(error) {
        console.error(`Error checking to see if CL#${changeListNumber} is valid.`);
        console.error('Error: ' + error);
    }
    return false;
};

var extractP4SwarmURLsFromMessage = async function(message) {
    let findRegexPattern = /.*?CL#([0-9]+).*/;
    let extractRegexPattern = /.*?CL#[0-9]+(.*)/;
    swarmURLArray = [];
    while(true) {
        let matches = findRegexPattern.exec(message);
        if(matches === null || matches.length === 0)
            break;
        let swarmURL = swarmURLPrefix + matches[1];
        let checkPromiseArray = [];
        if(shouldCheckURLValid) {
            checkPromiseArray.push(checkURL(swarmURL));
        }
        if(shouldCheckSwarmExists) {
            let changeListNumber = parseInt(matches[1], 10);
            checkPromiseArray.push(checkSwarmReviewExists(changeListNumber));
        }
        const checkPromiseResults = await Promise.all(checkPromiseArray);
        if(checkPromiseResults.every(result => result == true))
            swarmURLArray.push(swarmURL);
        message = message.replace(extractRegexPattern, '$1');
    }
    return swarmURLArray;
};

app.event('message', ({ event, say, client }) => {
    console.log('Message in channel event triggered!');
    console.log('Processing text: ' + event.text);
    extractP4SwarmURLsFromMessage(event.text).then((swarmURLArray) => {
        if(swarmURLArray.length === 0) {
            console.log('Did not find any swarm link URLs!');
        } else {
            console.log(`Found ${swarmURLArray.length} swarm link(s)...`);
            for(let i = 0; i < swarmURLArray.length; i++)
                console.log(`${i + 1}: ${swarmURLArray[i]}`);
            switch(shareMethod) {
                case ShareMethod.POST_IN_CHANNEL:
                case ShareMethod.POST_IN_THREAD: {
                    let message = '';
                    for(let i = 0; i < swarmURLArray.length; i++)
                        message += '\n' + swarmURLArray[i];
                    console.log('Share message...');
                    console.log(message);
                    say({
                        text: message,
                        thread_ts: (shareMethod == ShareMethod.POST_IN_THREAD) ? event.ts : undefined
                    });
                    break;
                }
                case ShareMethod.EDIT_MESSAGE: {
                    // Doing some more research on this, this method just isn't feasible, because it's not allowed.
                    // Trying to update the user's message always results in an error: 'cant_update_message'.
                    try {
                        client.chat.update({
                            channel: event.channel,
                            ts: event.ts,
                            text: 'This is a test!'
                        });
                    } catch(error) {
                        console.error('Error: ' + error);
                    }
                    break;
                }
            }
        }
    });
});

app.event('app_home_opened', async ({ event, client }) => {
    const view = {
        type: 'home',
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: 'Stupid hobbitses!  They stole our *Precious*!'
                }
            }
        ]
    };

    await client.views.publish({
        user_id: event.user,
        view: view
    });
});

(async () => {
    try {
        await app.start(process.env.PORT || 3000);
        console.log('App is running!');
    } catch(error) {
        console.error('Error starting app: ', error);
    }
})();