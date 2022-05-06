const URLS = [
    'https://www.tumblr.com/dashboard'
];

async function inject(tabId) {
    if (typeof tabId !== 'number') {
        console.assert(typeof tabId === 'number', typeof tabId);
        throw new Error(`${typeof tabId}: An invalid type.`);
    }

    const injectionResults = await chrome.scripting.executeScript({
        'target': {
            'tabId': tabId
        },
        'func': () => {
            return 'nonaltReblog' in window;
        },
        'world': 'MAIN'
    });
    if (injectionResults.length === 0) {
        console.assert(injectionResults.length === 1, injectionResults.length);
        throw new Error('Failed to inject the script.');
    }
    if (injectionResults.length >= 2) {
        console.assert(injectionResults.length === 1, injectionResults.length);
        throw new Error(`Unintended injection into ${injectionResults.length} frames.`);
    }
    const injected = injectionResults[0].result;

    if (injected === false) {
        await chrome.scripting.executeScript({
            'target': {
                'tabId': tabId
            },
            'files': [
                'injection.js'
            ],
            'world': 'MAIN'
        });
        await chrome.scripting.executeScript({
            'target': {
                'tabId': tabId
            },
            'func': extensionId => { nonaltReblog.extensionId = extensionId; },
            'args': [chrome.runtime.id],
            'world': 'MAIN'
        });
    }
}

const urlFilter = {
    'url': []
};
for (const url of URLS) {
    urlFilter.url.push({
        'urlEquals': url
    });
}
chrome.webNavigation.onCompleted.addListener(details => {
    const tabId = details.tabId;
    inject(tabId);
}, urlFilter);

chrome.tabs.query({
    url: URLS
}).then(tabs => {
    for (const tab of tabs) {
        inject(tab.id);
    }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    const type = message.type;
    if (typeof type !== 'string') {
        console.assert(typeof type === 'string', typeof type);
        sendResponse({
            'error_message': `${typeof type}: An invalid type.`
        });
        return true;
    }

    if (type === 'findInLocalStorage') {
        const key = message.key;
        if (typeof key !== 'string') {
            console.assert(typeof key === 'string', typeof key);
            sendResponse({
                'error_message': `${typeof key}: An invalid type.`
            });
            return true;
        }
        chrome.storage.local.get(key).then(items => {
            sendResponse({
                'error_message': null,
                'found': key in items
            });
        });
        return true;
    }

    if (type === 'postprocess') {
        const postUrl = message.post_url;
        if (typeof postUrl !== 'string') {
            console.assert(typeof postUrl === 'string', typeof postUrl);
            sendResponse({
                'error_message': `${typeof postUrl}: An invalid type.`
            });
            return true;
        }
        const originalPostUrl = message.original_post_url;
        if (typeof originalPostUrl !== 'string') {
            console.assert(typeof originalPostUrl === 'string', typeof originalPostUrl);
            sendResponse({
                'error_message': `${typeof originalPostUrl}: An invalid type.`
            });
            return true;
        }
        const userAgent = message.user_agent;
        if (typeof userAgent !== 'string') {
            console.assert(typeof userAgent === 'string', typeof userAgent);
            sendResponse({
                'error_message': `${typeof userAgent}: An invalid type.`
            });
            return true;
        }

        (async () => {
            const deadline = Date.now() + 60 * 1000;
            const pattern = /https:\/\/cryolite\.tumblr\.com\/post\/(\d+)/;
            while (Date.now() <= deadline) {
                const response = await fetch(postUrl, {
                    'method': 'GET',
                    'headers': {
                        'Accept': 'text/html',
                        'User-Agent': userAgent
                    },
                    'credentials': 'include'
                });
                if (!response.ok) {
                    console.warn(`Failed to connect to ${postUrl} (${response.status} ${response.statusText}).`);
                    continue;
                }

                const body = await response.text();
                if (body.search(pattern) !== -1) {
                    await chrome.storage.local.set({
                        [originalPostUrl]: Date.now()
                    });

                    const usageInBytes = await chrome.storage.local.getBytesInUse(null);
                    if (usageInBytes > chrome.storage.local.QUOTA_BYTES * 0.8) {
                        const items = await chrome.storage.local.get(null);
                        const numItems = items.length;

                        const itemsToRemove = Object.entries(items);
                        itemsToRemove.sort(item => item[1]);
                        while (itemsToRemove.length > numItems * 0.4) {
                            itemsToRemove.pop();
                        }
                        const keysToRemove = itemsToRemove.map(item => item[0]);
                        await chrome.storage.local.remove(keysToRemove);
                    }

                    sendResponse({
                        'error_message': null
                    });
                    return;
                }
            }

            console.error(`Failed to confirm the reblog of the post ${postUrl}.`);
            sendResponse({
                'error_message': `Failed to confirm the reblog of the post ${postUrl}.`
            })
        })();
        return true;
    }

    console.error(`${message.type}: An invalid value.`);
    sendResponse({
        'error_message': `${message.type}: An invalid value.`
    });
    return true;
});
