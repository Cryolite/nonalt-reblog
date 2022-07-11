import { Image, LocalStorageData, QueueForRebloggingResponse, RequestTypes, ResponseTypes, sleep } from './common';
import { executeScript, printError, createTab } from './background/common';
import { preflightOnPost } from './background/preflight';

const URLS = [
    'https://www.tumblr.com/dashboard'
];

async function queueForReblogging(tabId: number, postUrl: string, images: Image[], sendResponse: (message: QueueForRebloggingResponse) => void): Promise<void> {
    const items = await chrome.storage.local.get('reblogQueue') as LocalStorageData;
    if (items.reblogQueue === undefined) {
        items.reblogQueue = [];
    }
    items.reblogQueue.push({
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

interface ArtistInfoEntry {
    urls: string[];
    artistNames?: string[];
    circleNames?: string[];
}

interface ArtistInfo {
    artistNames: string[];
    circleNames: string[];
}

async function createArtistTagger(): Promise<Record<string, ArtistInfo>> {
    const artistTagger: Record<string, ArtistInfo> = {};
    {
        const url = chrome.runtime.getURL('data/artists.json');
        const response = await fetch(url);
        if (response.ok !== true) {
            throw new Error('Failed to read `artists.json`.')
        }

        const artistsInfo = await response.json() as ArtistInfoEntry[];
        for (const info of artistsInfo) {
            const artistNames = info.artistNames ?? [];
            const circleNames = info.circleNames ?? [];
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

async function dequeueForReblogging(tabId: number): Promise<void> {
    const artistTagger = await createArtistTagger();

    const reblogQueue = await (async () => {
        const items = await chrome.storage.local.get('reblogQueue') as LocalStorageData;
        return items.reblogQueue ?? [];
    })();

    while (reblogQueue.length > 0) {
        const postUrl = reblogQueue[0].postUrl;
        const artistUrls = (() => {
            const artistUrls = reblogQueue[0].images.map(x => x.artistUrl);
            return [...new Set(artistUrls)];
        })();
        const imageUrls = reblogQueue[0].images.map(x => x.imageUrl);

        {
            // Check if all the image URLs have already been recorded in the
            // local storage as reblogged, and if so, skip the post URL as it
            // does not need to be reblogged.
            let allReblogged = true;
            for (const imageUrl of imageUrls) {
                const items = await chrome.storage.local.get(imageUrl) as LocalStorageData;
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
                } as LocalStorageData);

                continue;
            }
        }

        // Construct tags if any.
        const tags = [];

        // Push artist names if any.
        for (const artistUrl of artistUrls) {
            if (artistUrl in artistTagger !== true) {
                continue;
            }
            const artistInfo = artistTagger[artistUrl];
            for (const artistName of artistInfo.artistNames) {
                tags.push(`${artistName} (イラストレータ)`);
            }
        }

        // Push circle names if any.
        for (const artistUrl of artistUrls) {
            if (artistUrl in artistTagger !== true) {
                continue;
            }
            const artistInfo = artistTagger[artistUrl];
            for (const circleName of artistInfo.circleNames) {
                tags.push(`${circleName} (サークル)`);
            }
        }

        const postId = /(\d+)$/.exec(postUrl)![1];

        // Extract the account name and reblog key.
        async function getAccountAndReblogKey(): Promise<[string, string]> {
            // First, try to extract the account name and reblog key from the
            // `links` of the post page.
            const newTab = await createTab({
                openerTabId: tabId,
                url: postUrl,
                active: false
            }, 60 * 1000);
            const newTabId = newTab.id!;
            const result = await executeScript({
                target: {
                    tabId: newTabId
                },
                func: (postId): [string, string] | string | null => {
                    const reblogHrefPattern = RegExp(`^https://www\\.tumblr\\.com/reblog/([^/]+)/${postId}/(\\w+)`);

                    for (const link of document.links) {
                        const href = link.href;
                        const matches = reblogHrefPattern.exec(href);
                        if (matches !== null) {
                            return [matches[1], matches[2]];
                        }
                    }

                    function impl(element: Element): string | null {
                        returnIframeSrc: {
                            if (element.nodeName !== 'IFRAME') {
                                break returnIframeSrc;
                            }

                            const iframe = element as HTMLIFrameElement;
                            return iframe.src;
                        }

                        const children = element.children;
                        for (const child of children) {
                            const iframeSrc = impl(child);
                            if (iframeSrc !== null) {
                                return iframeSrc;
                            }
                        }
                        return null;
                    }

                    return impl(document.body);
                },
                args: [postId],
                world: 'MAIN'
            });
            chrome.tabs.remove(newTabId);

            if (result instanceof Array) {
                // The account name and reblog key have been extracted from the
                // `links` of the post page.
                return result;
            }

            if (result === null) {
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
            const iframeTabId = iframeTab.id!;
            const iframeResult = await executeScript({
                target: {
                    tabId: iframeTabId
                },
                func: (postId): [string, string] | null => {
                    const reblogHrefPattern = RegExp(`^https://www\\.tumblr\\.com/reblog/([^/]+)/${postId}/(\\w+)`);

                    for (const link of document.links) {
                        const href = link.href;
                        const matches = reblogHrefPattern.exec(href);
                        if (matches !== null) {
                            return [matches[1], matches[2]];
                        }
                    }

                    return null;
                },
                args: [postId],
                world: 'MAIN'
            });
            chrome.tabs.remove(iframeTabId);

            if (iframeResult !== null) {
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
        }, 10 * 1000);
        const newTabId = newTab.id!;
        // Let the script wait for the `Reblog` button to appear.
        await sleep(6 * 1000);

        // Search the `Reblog` button and click it.
        await chrome.scripting.executeScript({
            target: {
                tabId: newTabId,
                allFrames: true
            },
            func: (postId, tags, reblogKey) => {
                function annotateTags(element: Element): boolean {
                    findAndInputTagEditor: {
                        if (element.nodeName !== 'DIV') {
                            break findAndInputTagEditor;
                        }
                        const div = element as HTMLDivElement;
                        const className = div.className;
                        if (className !== 'post-form--tag-editor') {
                            break findAndInputTagEditor;
                        }
                        const textContent = div.textContent;
                        // `textContent` has a zero-width space at its
                        // beginning, so simple equality check fails.
                        if ((textContent ?? '').indexOf('#tags') === -1) {
                            break findAndInputTagEditor;
                        }
                        const dataset = div.dataset;
                        if (dataset.subview !== 'tagEditor') {
                            break findAndInputTagEditor;
                        }

                        div.click();
                        const activeElement = document.activeElement!;
                        for (const tag of tags) {
                            activeElement.insertAdjacentText('afterbegin', tag);

                            const keyboardEvent = new KeyboardEvent('keydown', {
                                bubbles: true,
                                cancelable: true,
                                code: 'Enter',
                                keyCode: 13
                            });
                            activeElement.dispatchEvent(keyboardEvent);
                        }

                        return true;
                    }

                    for (const child of element.children) {
                        const result = annotateTags(child);
                        if (result === true) {
                            return true;
                        }
                    }
                    return false;
                }

                annotateTags(document.body);

                function impl(element: Element) {
                    checkAndClick: {
                        if (element.nodeName !== 'BUTTON') {
                            break checkAndClick;
                        }
                        const button = element as HTMLButtonElement;

                        const innerText = button.innerText;
                        if (innerText !== 'Reblog') {
                            break checkAndClick;
                        }

                        const formAction = button.formAction;
                        if (formAction !== `https://www.tumblr.com/neue_web/iframe/reblog/${postId}/${reblogKey}`) {
                            break checkAndClick;
                        }

                        button.click();
                        return true;
                    }

                    for (const child of element.children) {
                        const result = impl(child);
                        if (result === true) {
                            return true;
                        }
                    }
                    return false;
                }

                impl(document.body);
            },
            args: [postId, tags, reblogKey],
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
        chrome.tabs.remove(newTabId);
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

chrome.runtime.onMessage.addListener((message: RequestTypes, sender, sendResponse: (message: ResponseTypes) => void) => {
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

chrome.runtime.onMessageExternal.addListener((message: RequestTypes, sender, sendResponse: (message: ResponseTypes) => void) => {
    if (message.type === 'preflightOnPost') {
        preflightOnPost(message.tabId, message.postUrl, message.postImageUrls, message.hrefs, message.innerText, message.imageUrls, sendResponse);
        return true;
    }

    if (message.type === 'queueForReblogging') {
        queueForReblogging(message.tabId, message.postUrl, message.images, sendResponse);
        return true;
    }

    if (message.type === 'dequeueForReblogging') {
        dequeueForReblogging(message.tabId);
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

async function inject(tabId: number) {
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
            func: (scriptUrl: string, tabId: number, extensionId: string) => {
                const scriptElement = document.createElement('script');
                scriptElement.addEventListener('load', () => {
                    window.nonaltReblog.tabId = tabId;
                    window.nonaltReblog.extensionId = extensionId;
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

// Inject `injection.js` when a new page is opened.
const urlFilter = {
    url: URLS.map(url => ({urlEquals: url}))
};
chrome.webNavigation.onCompleted.addListener(details => {
    const tabId = details.tabId;
    inject(tabId);
}, urlFilter);

// Inject `injection.js` when this extension is installed or updated.
chrome.tabs.query({
    url: URLS
}).then(tabs => {
    for (const tab of tabs) {
        inject(tab.id!);
    }
});
