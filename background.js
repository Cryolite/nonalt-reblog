import { sleep, fetchImages } from "./common.js";

const URLS = [
    'https://www.tumblr.com/dashboard'
];

// Create a new tab and wait for the resource loading for the page on that tab
// to complete.
async function createTab(createProperties) {
    if ('openerTabId' in createProperties && 'windowId' in createProperties === false) {
        const openerTabId = createProperties.openerTabId;
        const openerTab = await chrome.tabs.get(openerTabId);
        const windowId = openerTab.windowId;
        createProperties.windowId = windowId;
    }

    const tab = await chrome.tabs.create(createProperties);

    const promise = new Promise((resolve, reject) => {
        chrome.webNavigation.onCompleted.addListener(details => {
            if (details.tabId !== tab.id) {
                return;
            }
            resolve(tab);
        });
    });

    return promise;
}

async function executeScript(scriptInjection) {
    const injectionResults = await chrome.scripting.executeScript(scriptInjection);
    if (injectionResults.length === 0) {
        console.assert(injectionResults.length === 1, injectionResults.length);
        const error = new Error('Script injection failed.');
        throw error;
    }
    if (injectionResults.length >= 2) {
        console.assert(injectionResults.length === 1, injectionResults.length);
        const error = new Error(`Unintended script injection into ${injectionResults.length} frames.`);
        throw error;
    }
    const injectionResult = injectionResults[0];
    return injectionResult.result;
}

async function expandPixivArtworks(tabId) {
    await executeScript({
        target: {
            tabId: tabId
        },
        func: () => {
            function expandImpl(element) {
                checkAndClick: {
                    if (typeof element.nodeName !== 'string') {
                        break checkAndClick;
                    }
                    const name = element.nodeName.toUpperCase();
                    if (name !== 'DIV') {
                        break checkAndClick;
                    }

                    const innerText = element.innerText;
                    if (innerText.search(/^\d+\/\d+$/) === -1) {
                        break checkAndClick;
                    }

                    const onclick = element.onclick;
                    if (onclick === null) {
                        break checkAndClick;
                    }

                    element.click();
                    return;
                }

                const children = element.children;
                if (typeof children !== 'object') {
                    return;
                }
                for (const child of children) {
                    expandImpl(child);
                }
            }

            expandImpl(document);
        },
        world: 'MAIN'
    });
}

async function getPixivImagesImpl(tabId, sourceUrl, images) {
    const newTab = await createTab({
        openerTabId: tabId,
        url: sourceUrl,
        active: false
    });
    // Resource loading for the page sometimes takes a long time. In such cases,
    // `chrome.tabs.remove` gets stuck. To avoid this, the following script
    // injection sets a time limit on resource loading for the page.
    await executeScript({
        target: {
            tabId: newTab.id
        },
        func: () => {
            setTimeout(() => {
                window.stop();
            }, 60 * 1000);
        },
        world: 'MAIN'
    });

    await expandPixivArtworks(newTab.id);

    const linkUrls = await executeScript({
        target: {
            tabId: newTab.id
        },
        func: () => {
            const links = [];
            for (let i = 0; i < document.links.length; ++i) {
                const link = document.links[i];
                const href = link.href;
                links.push(href);
            }
            return links;
        },
        world: 'MAIN'
    });

    const imageUrlPattern = /^https:\/\/i\.pximg\.net\/img-original\/img\/\d{4}(?:\/\d{2}){5}\/\d+_p0\.\w+/;
    const imageUrls = [];
    for (const imageUrl of linkUrls) {
        if (imageUrl.search(imageUrlPattern) === -1) {
            continue;
        }
        imageUrls.push(imageUrl);
    }

    const imageUrlsUniqued = [...new Set(imageUrls)];
    const newImages = await fetchImages(imageUrlsUniqued, sourceUrl);
    for (const newImage of newImages) {
        images.push(newImage);
    }

    chrome.tabs.remove(newTab.id);
}

async function getPixivImages(tabId, hrefs, innerText) {
    const sourceUrls = [];
    {
        const sourceUrlPattern = /^https:\/\/href\.li\/\?(https:\/\/www\.pixiv\.net)(?:\/en)?(\/artworks\/\d+)/;
        for (const href of hrefs) {
            const matches = sourceUrlPattern.exec(href);
            if (!Array.isArray(matches)) {
                continue;
            }
            sourceUrls.push(matches[1] + matches[2]);
        }
    }
    {
        const sourceUrlPattern = /^https:\/\/href\.li\/\?http:\/\/www\.pixiv\.net\/member_illust\.php\?mode=[^&]+&illust_id=(\d+)/;
        for (const href of hrefs) {
            const matches = sourceUrlPattern.exec(href);
            if (!Array.isArray(matches)) {
                continue;
            }
            sourceUrls.push('https://www.pixiv.net/artworks/' + matches[1]);
        }
    }

    const images = [];
    for (const sourceUrl of [...new Set(sourceUrls)]) {
        await getPixivImagesImpl(tabId, sourceUrl, images);
    }
    return images;
}

async function followTwitterShortUrl(url) {
    if (/^https:\/\/t\.co\/[0-9A-Za-z]+$/.test(url) !== true) {
        throw new Error(`${url}: An invalid URL.`);
    }

    const response = await fetch(url);
    if (response.ok !== true) {
        throw new Error(`${url}: Failed to fetch (${url.status}).`);
    }

    const responseBody = await response.text();
    const sourceUrlPattern = /(https:\/\/twitter\.com\/[^\/]+\/status\/\d+)/;
    const match = sourceUrlPattern.exec(responseBody);
    if (Array.isArray(match) !== true) {
        return null;
    }
    return match[1];
}

async function getTwitterImagesImpl(tabId, sourceUrl, images) {
    // To retrieve the URL of the original images from a Twitter tweet URL, open
    // the tweet page in the foreground, wait a few seconds, and extract the
    // URLs from the `images`.
    const newTab = await createTab({
        openerTabId: tabId,
        url: sourceUrl,
        active: true
    });
    // Resource loading for the page sometimes takes a long time. In such cases,
    // `chrome.tabs.remove` gets stuck. To avoid this, the following script
    // injection sets a time limit on resource loading for the page.
    await executeScript({
        target: {
            tabId: newTab.id
        },
        func: () => {
            setTimeout(() => {
                window.stop();
            }, 60 * 1000);
        },
        world: 'MAIN'
    });
    await sleep(5 * 1000);

    const imageUrls = await executeScript({
        target: {
            tabId: newTab.id
        },
        func: () => {
            const images = [];
            for (let i = 0; i < document.images.length; ++i) {
                const image = document.images[i];
                const currentSrc = image.currentSrc;
                images.push(currentSrc);
            }
            return images;
        },
        world: 'MAIN'
    });

    const imageUrlPattern = /^(https:\/\/pbs\.twimg\.com\/media\/[^\?]+\?format=[^&]+)&name=.+/;
    const imageUrlReplacement = '$1&name=orig';
    const originalImageUrls = [];
    for (const imageUrl of imageUrls) {
        if (imageUrl.search(imageUrlPattern) === -1) {
            continue;
        }
        const originalImageUrl = imageUrl.replace(imageUrlPattern, imageUrlReplacement);
        originalImageUrls.push(originalImageUrl);
    }

    const originalImageUrlsUniqued = [...new Set(originalImageUrls)];
    const newImages = await fetchImages(originalImageUrlsUniqued, sourceUrl);
    for (const newImage of newImages) {
        images.push(newImage);
    }

    chrome.tabs.remove(newTab.id);
}

async function getTwitterImages(tabId, hrefs, innerText) {
    const sourceUrls = [];
    {
        const sourceUrlPattern = /^https:\/\/href\.li\/\?(https:\/\/twitter\.com\/[^\/]+\/status\/\d+)/;
        for (const href of hrefs) {
            const matches = sourceUrlPattern.exec(href);
            if (Array.isArray(matches) !== true) {
                continue;
            }
            sourceUrls.push(matches[1]);
        }
    }
    {
        const shortUrlPattern = /^https:\/\/href\.li\/\?(https:\/\/t\.co\/[0-9A-Za-z]+)/;
        for (const href of hrefs) {
            const shortMatches = shortUrlPattern.exec(href);
            if (Array.isArray(shortMatches) === true) {
                const sourceUrl = await followTwitterShortUrl(shortMatches[1]);
                if (typeof sourceUrl === 'string') {
                    sourceUrls.push(sourceUrl);
                }
            }
        }
    }
    {
        const sourceUrlPattern = /(https:\/\/twitter\.com\/[^\/]+\/status\/\d+)/;
        const matches = sourceUrlPattern.exec(innerText);
        if (Array.isArray(matches) === true) {
            sourceUrls.push(matches[1]);
        }
    }
    {
        const shortUrlPattern = /(https:\/\/t\.co\/[0-9A-Za-z]+)/;
        const shortMatches = shortUrlPattern.exec(innerText);
        if (Array.isArray(shortMatches) === true) {
            const sourceUrl = await followTwitterShortUrl(shortMatches[1]);
            if (typeof sourceUrl === 'string') {
                sourceUrls.push(sourceUrl);
            }
        }
    }

    const images = [];
    for (const sourceUrl of [...new Set(sourceUrls)]) {
        await getTwitterImagesImpl(tabId, sourceUrl, images);
    }
    return images;
}

const imagesGetters = [
    getPixivImages,
    getTwitterImages
];

async function getImages(tabId, hrefs, innerText, sendResponse) {
    for (const imagesGetter of imagesGetters) {
        const images = await imagesGetter(tabId, hrefs, innerText);
        if (images.length >= 1) {
            sendResponse({
                errorMessage: null,
                images: images
            });
            return;
        }
    }
    sendResponse({
        errorMessage: null,
        images: []
    });
}

async function queueForReblogging(tabId, postUrl, imageUrls, sendResponse) {
    const items = await chrome.storage.local.get('reblogQueue');
    if ('reblogQueue' in items === false) {
        items['reblogQueue'] = [];
    }
    items['reblogQueue'].push({
        postUrl: postUrl,
        imageUrls: imageUrls
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

async function dequeueForReblogging(tabId) {
    const userAgent = executeScript({
        target: {
            tabId: tabId
        },
        func: () => navigator.userAgent,
        world: 'MAIN'
    });

    const items = await chrome.storage.local.get('reblogQueue');
    if ('reblogQueue' in items === false) {
        return;
    }
    const reblogQueue = items.reblogQueue;

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

        const imageUrls = reblogQueue[0].imageUrls;
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
                    Accept: 'text/html',
                    'User-Agent': userAgent
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

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    const type = message.type;
    if (typeof type !== 'string') {
        console.assert(typeof type === 'string', typeof type);
        sendResponse({
            errorMessage: `${typeof type}: An invalid type.`
        });
        return false;
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

    if (type === 'getImages') {
        const tabId = message.tabId;
        if (typeof tabId !== 'number') {
            console.assert(typeof tabId === 'number', typeof tabId);
            sendResponse({
                errorMessage: `${typeof tabId}: An invalid type.`
            });
            return false;
        }

        const hrefs = message.hrefs;
        if (!Array.isArray(hrefs)) {
            console.assert(Array.isArray(hrefs), typeof hrefs);
            sendResponse({
                errorMessage: `${typeof hrefs}: An invalid type.`
            });
            return false;
        }
        for (const href of hrefs) {
            if (typeof href !== 'string') {
                console.assert(typeof href === 'string', typeof href);
                sendResponse({
                    errorMessage: `${typeof href}: An invalid type.`
                });
                return false;
            }
        }

        const innerText = message.innerText;
        if (typeof innerText !== 'string') {
            console.assert(typeof innerText === 'string', typeof innerText);
            sendResponse({
                errorMessage: `${typeof innerText}: An invalid type.`
            })
            return false;
        }

        getImages(tabId, hrefs, innerText, sendResponse);
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

        const imageUrls = message.imageUrls;
        if (Array.isArray(imageUrls) === false) {
            console.assert(Array.isArray(imageUrls), typeof imageUrls);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: imageUrls => { console.assert(Array.isArray(imageUrls), typeof imageUrls); },
                args: [imageUrls]
            });
            sendResponse({
                errorMessage: `${typeof imageUrls}: An invalid type.`
            });
            return false;
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
                sendResponse({
                    errorMessage: `${typeof imageUrl}: An invalid type.`
                });
                return false;
            }
        }

        queueForReblogging(tabId, postUrl, imageUrls, sendResponse);
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
