const URLS = [
    'https://www.tumblr.com/dashboard'
];

async function sleep(milliseconds) {
    if (typeof milliseconds !== 'number') {
        console.assert(typeof milliseconds === 'number', typeof milliseconds);
        const error = new Error(`${typeof milliseconds}: An invalid type.`);
        throw error;
    }

    const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, milliseconds);
    });
    return promise;
}

async function createTab(createProperties) {
    const tab = await chrome.tabs.create(createProperties);

    const promise = new Promise((resolve, reject) => {
        chrome.webNavigation.onCompleted.addListener(details => {
            if (details.tabId !== tab.id) {
                return;
            }
            resolve(tab);
        }, {
            url: [
                {
                    urlMatches: createProperties.url
                }
            ]
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
                while (true) {
                    if (typeof element.nodeName !== 'string') {
                        break;
                    }
                    const name = element.nodeName.toUpperCase();
                    if (name !== 'DIV') {
                        break;
                    }

                    const innerText = element.innerText;
                    if (innerText.search(/^\d+\/\d+$/) === -1) {
                        break;
                    }

                    const onclick = element.onclick;
                    if (onclick === null) {
                        break;
                    }

                    element.click();
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

async function getPixivImageUrlsImpl(tabId, sourceUrl, imageUrls) {
    const newTab = await createTab({
        url: sourceUrl,
        active: false
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

    await chrome.tabs.remove(newTab.id);

    const imageUrlPattern = /^https:\/\/i\.pximg\.net\/img-original\/img\/\d{4}(?:\/\d{2}){5}\/\d+_p0\.\w+/;
    for (const imageUrl of linkUrls) {
        if (imageUrl.search(imageUrlPattern) === -1) {
            continue;
        }
        imageUrls.push(imageUrl);
    }
}

async function getPixivImageUrls(tabId, hrefs, innerText) {
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

    const imageUrls = [];
    for (const sourceUrl of [...new Set(sourceUrls)]) {
        await getPixivImageUrlsImpl(tabId, sourceUrl, imageUrls);
    }
    return [...new Set(imageUrls)];
}

async function getTwitterImageUrlsImpl(tabId, sourceUrl, originalImageUrls) {
    const newTab = await createTab({
        url: sourceUrl,
        active: true
    });
    await sleep(3000);

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

    {
        const tab = await chrome.tabs.get(tabId);
        await chrome.tabs.highlight({
            tabs: tab.index
        });
    }
    await chrome.tabs.remove(newTab.id);

    const imageUrlPattern = /^(https:\/\/pbs\.twimg\.com\/media\/[^\?]+\?format=[^&]+)&name=.+/;
    const imageUrlReplacement = '$1&name=orig';
    for (const imageUrl of imageUrls) {
        if (imageUrl.search(imageUrlPattern) === -1) {
            continue;
        }
        const originalImageUrl = imageUrl.replace(imageUrlPattern, imageUrlReplacement);
        originalImageUrls.push(originalImageUrl);
    }
}

async function getTwitterImageUrls(tabId, hrefs, innerText) {
    const sourceUrls = [];
    {
        const sourceUrlPattern = /^https:\/\/href\.li\/\?(https:\/\/twitter\.com\/[^\/]+\/status\/\d+)/;
        for (const href of hrefs) {
            const matches = sourceUrlPattern.exec(href);
            if (!Array.isArray(matches)) {
                continue;
            }
            sourceUrls.push(matches[1]);
        }
    }
    {
        const sourceUrlPattern = /(https:\/\/twitter\.com\/[^\/]+\/status\/\d+)/;
        const matches = sourceUrlPattern.exec(innerText);
        if (Array.isArray(matches)) {
            sourceUrls.push(matches[1]);
        }
    }

    const imageUrls = [];
    for (const sourceUrl of [...new Set(sourceUrls)]) {
        await getTwitterImageUrlsImpl(tabId, sourceUrl, imageUrls);
    }
    return [...new Set(imageUrls)];
}

const imageUrlsGetters = [
    getPixivImageUrls,
    getTwitterImageUrls
]

async function getImageUrls(tabId, hrefs, innerText, sendResponse) {
    for (const imageUrlsGetter of imageUrlsGetters) {
        const imageUrls = await imageUrlsGetter(tabId, hrefs, innerText);
        if (imageUrls.length >= 1) {
            sendResponse({
                errorMessage: null,
                imageUrls: imageUrls
            });
            return;
        }
    }
    sendResponse({
        errorMessage: null,
        imageUrls: []
    });
}

async function isInPreflight(tabId) {
    return await executeScript({
        target: {
            tabId: tabId
        },
        func: () => {
            return nonaltReblog.preflight;
        },
        world: 'MAIN'
    });
}

async function togglePreflight(tabId) {
    if (!await isInPreflight(tabId)) {
        await executeScript({
            target: {
                tabId: tabId
            },
            func: () => {
                nonaltReblog.preflight = true;
            },
            world: 'MAIN'
        });

        chrome.contextMenus.update('togglePreflight', {
            title: 'Stop preflight'
        }, () => {});

        chrome.scripting.executeScript({
            target: {
                tabId: tabId
            },
            func: () => { nonaltReblog.initiatePreflight(); },
            world: 'MAIN'
        });

        return;
    }

    await chrome.scripting.executeScript({
        target: {
            tabId: tabId
        },
        func: () => {
            nonaltReblog.preflight = false;
        },
        world: 'MAIN'
    });

    chrome.contextMenus.update('togglePreflight', {
        title: 'Start preflight'
    }, () => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    const menuItemId = info.menuItemId;
    if (menuItemId === 'togglePreflight') {
        const pageUrl = info.pageUrl;
        if (!URLS.includes(pageUrl)) {
            console.assert(URLS.includes(pageUrl), pageUrl);
            return;
        }

        if ('parentMenuItemId' in info) {
            console.assert('parentMenuItemId' in info === false);
            return;
        }

        const tabId = tab.id;
        togglePreflight(tabId);
        return;
    }

    console.error(`${menuItemId}: An unknown menu item ID.`);
    return;
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

    if (type === 'getImageUrls') {
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
        for (href of hrefs) {
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

        getImageUrls(tabId, hrefs, innerText, sendResponse);
        return true;
    }

    if (type === 'postprocess') {
        const userAgent = message.userAgent;
        if (typeof userAgent !== 'string') {
            console.assert(typeof userAgent === 'string', typeof userAgent);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: userAgent => { console.assert(typeof userAgent === 'string', typeof userAgent); },
                args: [userAgent]
            });
            sendResponse({
                errorMessage: null
            });
            return false;
        }

        const tabId = message.tabId;
        if (typeof tabId !== 'number') {
            console.assert(typeof tabId !== 'number', typeof tabId);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: tabId => { console.assert(typeof tabId !== 'number', typeof tabId); },
                args: [tabId]
            });
            sendResponse({
                errorMessage: null
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
                errorMessage: null
            });
            return false;
        }

        const imageUrls = message.imageUrls;
        if (!Array.isArray(imageUrls)) {
            console.assert(Array.isArray(imageUrls), typeof imageUrls);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: imageUrls => { console.assert(Array.isArray(imageUrls), typeof imageUrls); },
                args: [imageUrls]
            });
            sendResponse({
                errorMessage: null
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
                    errorMessage: null
                });
                return false;
            }
        }

        (async () => {
            const deadline = Date.now() + 60 * 1000;
            const myAccountPattern = /https:\/\/cryolite\.tumblr\.com/;
            while (Date.now() <= deadline) {
                const response = await fetch(postUrl, {
                    method: 'GET',
                    headers: {
                        Accept: 'text/html',
                        'User-Agent': userAgent
                    },
                    credentials: 'include'
                });
                if (response.ok === false) {
                    console.warn(`Failed to connect to ${postUrl} (${response.status} ${response.statusText}).`);
                    executeScript({
                        target: {
                            tabId: tabId
                        },
                        func: (postUrl, status, statusText) => { console.warn(`Failed to connect to ${postUrl} (${status} ${statusText}).`); },
                        args: [postUrl, response.status, response.statusText]
                    });
                    continue;
                }

                const body = await response.text();
                if (body.search(myAccountPattern) !== -1) {
                    for (const imageUrl of imageUrls) {
                        chrome.storage.local.set({
                            [imageUrl]: Date.now()
                        });
                    }

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
                        func: postUrl => { console.info(`${postUrl}: Confirmed the reblog.`); },
                        args: [postUrl]
                    });
                    return;
                }
            }

            console.error(`${postUrl}: Failed to confirm the reblog.`);
            executeScript({
                target: {
                    tabId: tabId
                },
                func: postUrl => { console.info(`${postUrl}: Failed to confirm the reblog.`); },
                args: [postUrl]
            });
            return;
        })();
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

    if (!injected) {
        await executeScript({
            target: {
                tabId: tabId
            },
            files: [
                'injection.js'
            ],
            world: 'MAIN'
        });

        await chrome.scripting.executeScript({
            target: {
                tabId: tabId
            },
            func: (tabId, extensionId) => {
                nonaltReblog.tabId = tabId;
                nonaltReblog.extensionId = extensionId;
            },
            args: [tabId, chrome.runtime.id],
            world: 'MAIN'
        });

        chrome.contextMenus.create({
            documentUrlPatterns: URLS,
            id: 'togglePreflight',
            title: 'Start preflight'
        }, () => {});
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
