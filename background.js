import { sleep } from './common.js';
import { executeScript, createTab } from './background/common.js';
import { preflightOnPost } from './background/preflight.js';

const URLS = [
    'https://www.tumblr.com/dashboard'
];

async function savePostUrlToImages(postUrlToImages) {
    const items = await chrome.storage.local.get('postUrlToImages');
    if ('postUrlToImages' in items === false) {
        items['postUrlToImages'] = {};
    }
    Object.assign(items['postUrlToImages'], postUrlToImages);
    await chrome.storage.local.set(items);
}

async function queueForReblogging(tabId, postUrl, images, sendResponse) {
    const items = await chrome.storage.local.get('reblogQueue');
    if ('reblogQueue' in items === false) {
        items['reblogQueue'] = [];
    }
    items['reblogQueue'].push({
        postUrl: postUrl,
        images: images
    });
    await chrome.storage.local.set(items);

    executeScript({
        target: {
            tabId: tabId
        },
        func: postUrl => { console.info(`${postUrl}: Queued for reblogging.`); },
        args: [postUrl]
    });

    sendResponse({
        errorMessage: null
    });
}

async function createArtistTagger() {
    const artistTagger = {};
    {
        const url = chrome.runtime.getURL('artists.json');
        const response = await fetch(url);
        if (response.ok !== true) {
            throw new Error('Failed to read `artists.json`.')
        }
    
        const artistsInfo = await response.json();
        for (const info of artistsInfo) {
            const artistNames = 'artistNames' in info ? info.artistNames : [];
            const circleNames = 'circleNames' in info ? info.circleNames : [];
            for (const url of info.urls) {
                artistTagger[url] = {
                    artistNames: artistNames,
                    circleNames: circleNames
                };
            }
        }
    }
    return artistTagger;
}

async function dequeueForReblogging(tabId) {
    const artistTagger = await createArtistTagger();

    const reblogQueue = await (async () => {
        const items = await chrome.storage.local.get('reblogQueue');
        if ('reblogQueue' in items === false) {
            return;
        }
        return items.reblogQueue;
    })();

    while (reblogQueue.length > 0) {
        const postUrl = reblogQueue[0].postUrl;
        if (typeof postUrl !== 'string') {
            console.assert(typeof postUrl === 'string', typeof postUrl);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: (postUrl) => { console.assert(typeof postUrl === 'string', typeof postUrl); },
                args: [postUrl]
            })
            return;
        }

        const artistUrls = (() => {
            const artistUrls = reblogQueue[0].images.map(x => x.artistUrl);
            return [...new Set(artistUrls)];
        })();
        if (Array.isArray(artistUrls) === false) {
            console.assert(Array.isArray(artistUrls), typeof artistUrls);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: artistUrls => { console.assert(Array.isArray(artistUrls), typeof artistUrls); },
                args: [artistUrls]
            });
            return;
        }
        for (const artistUrl of artistUrls) {
            if (typeof artistUrl !== 'string') {
                console.assert(typeof artistUrl === 'string', typeof artistUrl);
                executeScript({
                    target: {
                        tabId: tabId
                    },
                    func: artistUrl => { console.assert(typeof artistUrl === 'string', typeof artistUrl); },
                    args: [artistUrl]
                });
                return;
            }
        }

        const imageUrls = reblogQueue[0].images.map(x => x.imageUrl);
        if (Array.isArray(imageUrls) === false) {
            console.assert(Array.isArray(imageUrls), typeof imageUrls);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: imageUrls => { console.assert(Array.isArray(imageUrls), typeof imageUrls); },
                args: [imageUrls]
            });
            return;
        }
        for (const imageUrl of imageUrls) {
            if (typeof imageUrl !== 'string') {
                console.assert(typeof imageUrl === 'string', typeof imageUrl);
                executeScript({
                    target: {
                        tabId: tabId
                    },
                    func: imageUrl => { console.assert(typeof imageUrl === 'string', typeof imageUrl); },
                    args: [imageUrl]
                });
                return;
            }
        }

        {
            // Check if all the image URLs have already been recorded in the
            // local storage as reblogged, and if so, skip the post URL as it
            // does not need to be reblogged.
            let allReblogged = true;
            for (const imageUrl of imageUrls) {
                const items = await chrome.storage.local.get(imageUrl);
                if (imageUrl in items === false) {
                    allReblogged = false;
                    break;
                }
            }
            if (allReblogged === true) {
                executeScript({
                    target: {
                        tabId: tabId
                    },
                    func: postUrl => { console.info(`${postUrl}: Already reblogged.`); },
                    args: [postUrl]
                });

                reblogQueue.shift();
                await chrome.storage.local.set({
                    reblogQueue: reblogQueue
                });

                continue;
            }
        }

        const postId = /(\d+)$/.exec(postUrl)[1];

        // Extract the account name and reblog key.
        async function getAccountAndReblogKey () {
            // First, try to extract the account name and reblog key from the
            // `links` of the post page.
            const newTab = await createTab({
                openerTabId: tabId,
                url: postUrl,
                active: false
            });
            const result = await executeScript({
                target: {
                    tabId: newTab.id
                },
                func: postId => {
                    const reblogHrefPattern = RegExp(`^https://www\\.tumblr\\.com/reblog/([^/]+)/${postId}/(\\w+)`);

                    for (const link of document.links) {
                        const href = link.href;
                        const matches = reblogHrefPattern.exec(href);
                        if (Array.isArray(matches) === true) {
                            return [matches[1], matches[2]];
                        }
                    }

                    function impl(element) {
                        returnIframeSrc: {
                            if (typeof element.nodeName !== 'string') {
                                break returnIframeSrc;
                            }
                            const name = element.nodeName.toUpperCase();
                            if (name !== 'IFRAME') {
                                break returnIframeSrc;
                            }

                            const src = element.src;
                            if (typeof src !== 'string') {
                                break returnIframeSrc;
                            }

                            return src;
                        }

                        const children = element.children;
                        if (typeof children !== 'object') {
                            return null;
                        }
                        for (const child of children) {
                            const iframeSrc = impl(child);
                            if (typeof iframeSrc === 'string') {
                                return iframeSrc;
                            }
                        }
                        return null;
                    }
    
                    return impl(document);
                },
                args: [postId],
                world: 'MAIN'
            });
            chrome.tabs.remove(newTab.id);

            if (Array.isArray(result) === true) {
                // The account name and reblog key have been extracted from the
                // `links` of the post page.
                return result;
            }

            if (typeof result !== 'string') {
                const errorMessage = `${postUrl}: Failed to extract the reblog key.`;
                console.warn(errorMessage);
                executeScript({
                    target: {
                        tabId: tabId
                    },
                    func: errorMessage => { console.warn(errorMessage); },
                    args: [errorMessage]
                });
                throw new Error(errorMessage);
            }

            // As a fallback when the account name and reblog key could not be
            // extracted from the `links` on the post page, try to extract them
            // from the `iframe` of the post page.
            const iframeTab = await chrome.tabs.create({
                openerTabId: tabId,
                url: result,
                active: false
            });
            const iframeResult = await executeScript({
                target: {
                    tabId: iframeTab.id
                },
                func: postId => {
                    const reblogHrefPattern = RegExp(`^https://www\\.tumblr\\.com/reblog/([^/]+)/${postId}/(\\w+)`);

                    for (const link of document.links) {
                        const href = link.href;
                        const matches = reblogHrefPattern.exec(href);
                        if (Array.isArray(matches) === true) {
                            return [matches[1], matches[2]];
                        }
                    }

                    return null;
                },
                args: [postId],
                world: 'MAIN'
            });
            chrome.tabs.remove(iframeTab.id);

            if (Array.isArray(iframeResult) === true) {
                // The account name and reblog key have been extracted from the
                // `iframe` of the post page.
                return iframeResult;
            }

            const errorMessage = `${postUrl}: Failed to extract the reblog key.`;
            console.warn(errorMessage);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: errorMessage => { console.warn(errorMessage); },
                args: [errorMessage]
            });
            throw new Error(errorMessage);
        }
        const [account, reblogKey] = await (async () => {
            // The function `getAccountAndReblogKey` often fails to execute,
            // so several retries are made.
            for (let i = 0; i < 5; ++i) {
                try {
                    return await getAccountAndReblogKey();
                } catch (error) {
                }
            }

            reblogQueue.shift();
            await chrome.storage.local.set({
                reblogQueue: reblogQueue
            });

            const errorMessage = `${postUrl}: Failed to extract the reblog key.`;
            console.error(errorMessage);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: errorMessage => { console.error(errorMessage); },
                args: [errorMessage]
            });
            throw new Error(errorMessage);
        })();

        const newTab = await createTab({
            openerTabId: tabId,
            url: `https://www.tumblr.com/reblog/${account}/${postId}/${reblogKey}`,
            active: true
        });
        // Resource loading for the page often takes a long time. In such cases,
        // `chrome.tabs.remove` gets stuck. To avoid this, the following script
        // injection sets a time limit on resource loading for the page.
        await executeScript({
            target: {
                tabId: newTab.id
            },
            func: () => {
                setTimeout(() => {
                    window.stop();
                }, 10 * 1000);
            },
            world: 'MAIN'
        });
        // Let the script wait for the `Reblog` button to appear.
        await sleep(6 * 1000);

        // Search the `Reblog` button and click it.
        await chrome.scripting.executeScript({
            target: {
                tabId: newTab.id,
                allFrames: true
            },
            func: (postId, reblogKey) => {
                function impl(element) {
                    checkAndClick: {
                        if (typeof element.nodeName !== 'string') {
                            break checkAndClick;
                        }
                        const name = element.nodeName.toUpperCase();
                        if (name !== 'BUTTON') {
                            break checkAndClick;
                        }

                        const innerText = element.innerText;
                        if (innerText !== 'Reblog') {
                            break checkAndClick;
                        }

                        const formAction = element.formAction;
                        if (formAction !== `https://www.tumblr.com/neue_web/iframe/reblog/${postId}/${reblogKey}`) {
                            break checkAndClick;
                        }

                        element.click();
                        return true;
                    }

                    if (typeof element.children !== 'object') {
                        return false;
                    }
                    for (const child of element.children) {
                        const result = impl(child);
                        if (result === true) {
                            return true;
                        }
                    }
                    return false;
                }

                impl(document);
            },
            args: [postId, reblogKey],
            world: 'MAIN'
        });

        // If the reblog is successfully committed, the post URL should appear
        // on my page. The following loop periodically checks it to see if the
        // reblog was successful.
        const deadline = Date.now() + 60 * 1000;
        const myDomain = 'https://cryolite.tumblr.com/'
        let confirmed = false;
        while (Date.now() <= deadline) {
            const response = await fetch(myDomain, {
                method: 'GET',
                headers: {
                    Accept: 'text/html'
                },
                credentials: 'include'
            });
            if (response.ok === false) {
                console.warn(`Failed to connect to ${myDomain} (${response.status} ${response.statusText}).`);
                executeScript({
                    target: {
                        tabId: tabId
                    },
                    func: (myDomain, status, statusText) => { console.warn(`Failed to connect to ${myDomain} (${status} ${statusText}).`); },
                    args: [myDomain, response.status, response.statusText]
                });
                continue;
            }

            const body = await response.text();
            if (body.indexOf(postUrl) !== -1) {
                // The post URL certainly appeared on my page. This assures the
                // reblog has been successfully committed.

                // Record the image URLs in the local storage.
                for (const imageUrl of imageUrls) {
                    chrome.storage.local.set({
                        [imageUrl]: Date.now()
                    });
                }

                // When the capacity of the local storage is running low,
                // recorded image URLs are deleted from the oldest.
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

                executeScript({
                    target: {
                        tabId: tabId
                    },
                    func: postUrl => { console.info(`${postUrl}: Reblogged.`); },
                    args: [postUrl]
                });

                reblogQueue.shift();
                await chrome.storage.local.set({
                    reblogQueue: reblogQueue
                });
                confirmed = true;
                break;
            }
        }
        chrome.tabs.remove(newTab.id);
        if (confirmed === true) {
            continue;
        }

        console.error(`${postUrl}: Failed to confirm the reblog.`);
        executeScript({
            target: {
                tabId: tabId
            },
            func: postUrl => { console.error(`${postUrl}: Failed to confirm the reblog.`); },
            args: [postUrl]
        });
        return;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = message.type;
    if (typeof type !== 'string') {
        console.assert(typeof type === 'string', typeof type);
        sendResponse({
            errorMessage: `${typeof type}: An invalid type.`
        });
        return false;
    }

    if (type === 'loadPostUrlToImages') {
        (async () => {
            const items = await chrome.storage.local.get('postUrlToImages');
            if ('postUrlToImages' in items !== true) {
                sendResponse({
                    errorMessage: null,
                    postUrlToImages: {}
                });
                return;
            }
            sendResponse({
                errorMessage: null,
                postUrlToImages: items.postUrlToImages
            });
        })();
        return true;
    }

    console.error(`${message.type}: An invalid message type.`);
    sendResponse({
        errorMessage: `${message.type}: An invalid message type.`
    });
    return false;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    const type = message.type;
    if (typeof type !== 'string') {
        console.assert(typeof type === 'string', typeof type);
        sendResponse({
            errorMessage: `${typeof type}: An invalid type.`
        });
        return false;
    }

    if (type === 'findInReblogQueue') {
        const key = message.key;
        if (typeof key !== 'string') {
            console.assert(typeof key === 'string', typeof key);
            sendResponse({
                errorMessage: `${typeof key}: An invalid type.`
            });
            return false;
        }

        (async () => {
            const items = await chrome.storage.local.get('reblogQueue');
            if ('reblogQueue' in items !== true) {
                sendResponse({
                    errorMessage: null,
                    found: false
                });
                return;
            }
            const reblogQueue = items.reblogQueue;

            const imageUrls = reblogQueue.map(x => x.images).flat().map(x => x.imageUrl);
            sendResponse({
                errorMessage: null,
                found: imageUrls.includes(key)
            });
        })();

        return true;
    }

    if (type === 'findInLocalStorage') {
        const key = message.key;
        if (typeof key !== 'string') {
            console.assert(typeof key === 'string', typeof key);
            sendResponse({
                errorMessage: `${typeof key}: An invalid type.`
            });
            return false;
        }

        chrome.storage.local.get(key).then(items => {
            sendResponse({
                errorMessage: null,
                found: key in items
            });
        });
        return true;
    }

    if (type === 'preflightOnPost') {
        const tabId = message.tabId;
        if (typeof tabId !== 'number') {
            console.assert(typeof tabId !== 'number', typeof tabId);
            sendResponse({
                errorMessage: `${typeof tabId}: An invalid type for \`message.tabId\`.`
            });
            return false;
        }

        const postUrl = message.postUrl;
        if (typeof postUrl !== 'string') {
            console.assert(typeof postUrl === 'string', typeof postUrl);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: postUrl => { console.assert(typeof postUrl === 'string', typeof postUrl); },
                args: [postUrl]
            });
            sendResponse({
                errorMessage: `${typeof postUrl}: An invalid type.`
            });
            return false;
        }

        const postImageUrls = message.postImageUrls;
        if (Array.isArray(postImageUrls) !== true) {
            console.assert(Array.isArray(postImageUrls), typeof postImageUrls);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: postImageUrls => console.assert(Array.isArray(postImageUrls), typeof postImageUrls),
                args: [postImageUrls]
            });
            sendResponse({
                errorMessage: `${typeof postImageUrls}: An invalid type.`
            });
            return false;
        }
        for (const postImageUrl of postImageUrls) {
            if (typeof postImageUrl !== 'string') {
                console.assert(typeof postImageUrl === 'string', typeof postImageUrl);
                executeScript({
                    target: {
                        tabId: tabId
                    },
                    func: postImageUrl => console.assert(typeof postImageUrl === 'string', typeof postImageUrl),
                    args: [postImageUrl]
                });
                sendResponse({
                    errorMessage: `${typeof postImageUrl}: An invalid type.`
                });
                return false;
            }
        }

        const hrefs = message.hrefs;
        if (Array.isArray(hrefs) !== true) {
            console.assert(Array.isArray(hrefs), typeof hrefs);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: hrefs => console.assert(Array.isArray(hrefs), typeof hrefs),
                args: [hrefs]
            });
            sendResponse({
                errorMessage: `${typeof hrefs}: An invalid type.`
            });
            return false;
        }
        for (const href in hrefs) {
            if (typeof href !== 'string') {
                console.assert(typeof href === 'string', typeof href);
                executeScript({
                    target: {
                        tabId: tabId
                    },
                    func: href => { console.assert(typeof href === 'string', typeof href); },
                    args: [href]
                });
                sendResponse({
                    errorMessage: `${typeof href}: An invalid type.`
                });
                return false;
            }
        }

        const innerText = message.innerText;
        if (typeof innerText !== 'string') {
            console.assert(typeof innerText === 'string', typeof innerText);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: innerText => console.assert(typeof innerText === 'string', typeof innerText),
                args: [innerText]
            });
            sendResponse({
                errorMessage: `${typeof innerText}: An invalid type.`
            });
            return false;
        }

        preflightOnPost(tabId, postUrl, postImageUrls, hrefs, innerText, sendResponse);
        return true;
    }

    if (type === 'savePostUrlToImages') {
        const postUrlToImages = message.postUrlToImages;
        if (typeof postUrlToImages !== 'object') {
            console.assert(typeof postUrlToImages === 'object', typeof postUrlToImages);
            sendResponse({
                errorMessage: `${typeof postUrlToImages}: An invalid type for \`postUrlToImages\`.`
            });
            return false;
        }
        for (const [postUrl, images] of Object.entries(postUrlToImages)) {
            if (typeof postUrl !== 'string') {
                console.assert(typeof postUrl === 'string', typeof postUrl);
                sendResponse({
                    errorMessage: `${typeof postUrl}: An invalid type for \`postUrl\`.`
                });
                return false;
            }

            if (Array.isArray(images) !== true) {
                console.assert(Array.isArray(images) === true, typeof images);
                sendResponse({
                    errorMessage: `${typeof images}: An invalid type for \`images\`.`
                });
                return false;
            }
            for (const image of images) {
                const artistUrl = image.artistUrl;
                if (typeof artistUrl !== 'string') {
                    console.assert(typeof artistUrl === 'string', typeof artistUrl);
                    sendResponse({
                        errorMessage: `${typeof artistUrl}: An invalid type for \`artistUrl\`.`
                    });
                    return false;
                }

                const imageUrl = image.imageUrl;
                if (typeof imageUrl !== 'string') {
                    console.assert(typeof imageUrl === 'string', typeof imageUrl);
                    sendResponse({
                        errorMessage: `${typeof imageUrl}: An invalid type for \`imageUrl\`.`
                    });
                    return false;
                }
            }
        }

        savePostUrlToImages(postUrlToImages);
        return true;
    }

    if (type === 'queueForReblogging') {
        const tabId = message.tabId;
        if (typeof tabId !== 'number') {
            console.assert(typeof tabId !== 'number', typeof tabId);
            sendResponse({
                errorMessage: `${typeof tabId}: An invalid type for \`message.tabId\`.`
            });
            return false;
        }

        const postUrl = message.postUrl;
        if (typeof postUrl !== 'string') {
            console.assert(typeof postUrl === 'string', typeof postUrl);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: postUrl => { console.assert(typeof postUrl === 'string', typeof postUrl); },
                args: [postUrl]
            });
            sendResponse({
                errorMessage: `${typeof postUrl}: An invalid type.`
            });
            return false;
        }

        const images = message.images;
        if (Array.isArray(images) !== true) {
            console.assert(Array.isArray(images), typeof images);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: images => { console.assert(Array.isArray(images), typeof images); },
                args: [images]
            });
            sendResponse({
                errorMessage: `${typeof images}: An invalid type.`
            });
            return false;
        }
        for (const image of images) {
            const artistUrl = image.artistUrl;
            if (typeof artistUrl !== 'string') {
                console.assert(typeof artistUrl === 'string', typeof artistUrl);
                executeScript({
                    target: {
                        tabId: tabId
                    },
                    func: artistUrl => { console.assert(typeof artistUrl === 'string', typeof artistUrl); },
                    args: [artistUrl]
                });
                sendResponse({
                    errorMessage: `${typeof artistUrl}: An invalid type.`
                });
                return false;
            }

            const imageUrl = image.imageUrl;
            if (typeof imageUrl !== 'string') {
                console.assert(typeof imageUrl === 'string', typeof imageUrl);
                executeScript({
                    target: {
                        tabId: tabId
                    },
                    func: imageUrl => { console.assert(typeof imageUrl === 'string', typeof imageUrl); },
                    args: [imageUrl]
                });
                sendResponse({
                    errorMessage: `${typeof imageUrl}: An invalid type.`
                });
                return false;
            }
        }

        queueForReblogging(tabId, postUrl, images, sendResponse);
        return true;
    }

    if (type === 'dequeueForReblogging') {
        const tabId = message.tabId;
        if (typeof tabId !== 'number') {
            console.assert(typeof tabId !== 'number', typeof tabId);
            sendResponse({
                errorMessage: `${typeof tabId}: An invalid type.`
            });
            return false;
        }

        dequeueForReblogging(tabId);
        sendResponse({
            errorMessage: null
        });
        return false;
    }

    console.error(`${message.type}: An invalid value.`);
    sendResponse({
        errorMessage: `${message.type}: An invalid value.`
    });
    return false;
});

async function inject(tabId) {
    if (typeof tabId !== 'number') {
        console.assert(typeof tabId === 'number', typeof tabId);
        const error = new Error(`${typeof tabId}: An invalid type.`)
        throw error;
    }

    const injected = await executeScript({
        target: {
            tabId: tabId
        },
        func: () => {
            return 'nonaltReblog' in window;
        },
        world: 'MAIN'
    });

    if (injected !== true) {
        await executeScript({
            target: {
                tabId: tabId
            },
            func: (scriptUrl, tabId, extensionId) => {
                const scriptElement = document.createElement('script');
                scriptElement.addEventListener('load', () => {
                    nonaltReblog.tabId = tabId;
                    nonaltReblog.extensionId = extensionId;
                });
                scriptElement.addEventListener('error', () => {
                    console.error(`Failed to load \`${scriptUrl}\`.`);
                });
                scriptElement.type = 'module';
                scriptElement.src = scriptUrl;
                document.head.append(scriptElement);
            },
            args: [chrome.runtime.getURL('injection.js'), tabId, chrome.runtime.id],
            world: 'MAIN'
        });
    }
}

// Inject `injection.js` when a new page is openend.
const urlFilter = {
    url: []
};
for (const url of URLS) {
    urlFilter.url.push({
        urlEquals: url
    });
}
chrome.webNavigation.onCompleted.addListener(details => {
    const tabId = details.tabId;
    inject(tabId);
}, urlFilter);

// Inject `injection.js` when this extension is installed or updated.
chrome.tabs.query({
    url: URLS
}).then(tabs => {
    for (const tab of tabs) {
        inject(tab.id);
    }
});
