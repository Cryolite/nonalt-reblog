import { getLeftMostPostUrlInInnerHtml, LocalStorageData, sendMessageToExtension } from "./common";
import { createTab, executeScript } from "./background/common";

(async () => {
    const postUrls = await (async () => {
        const result = await sendMessageToExtension(chrome.runtime.id, {
            type: 'loadPostUrlToImages'
        });
        if (result.errorMessage !== null) {
            throw new Error(result.errorMessage);
        }
        const postUrlToImages = result.postUrlToImages;
        const postUrls = Object.keys(postUrlToImages);

        const pattern = /\d+$/;
        const compareFunction = (lhs: string, rhs: string) => {
            // TODO: Handle mismatches.
            const l = parseInt(pattern.exec(lhs)![0], 10);
            const r = parseInt(pattern.exec(rhs)![0], 10);
            return l - r;
        };
        postUrls.sort(compareFunction);
        return postUrls;
    })();

    for (const postUrl of postUrls) {
        const embedUrl = `${postUrl}/embed`;

        const newTab = await createTab({
            url: embedUrl,
            active: false
        }, 60 * 1000);
        const newTabId = newTab.id!;
        const embedCode = await executeScript({
            target: {
                tabId: newTabId
            },
            func: () => {
                const elementCandidates = document.getElementsByClassName('embed-code');
                if (elementCandidates.length === 0) {
                    return null;
                }
                if (elementCandidates.length >= 2) {
                    return null;
                }
                const element = elementCandidates[0];
                if (element.nodeName !== 'TEXTAREA') {
                    return null;
                }
                const textarea = element as HTMLTextAreaElement
                return textarea.value;
            }
        });
        await chrome.tabs.remove(newTabId);
        if (embedCode === null) {
            console.error(`${embedUrl}: Failed to get the embed code.`);
            continue;
        }

        document.body.insertAdjacentHTML('beforeend', `<div tabindex="0"><a href="${postUrl}" style="display: none;"></a></div>`);
        const postContainerElement = document.body.children[document.body.children.length - 1];

        const newEmbedCode = embedCode.replace(/\\x3Cscript\s.+?<\/script>/, '')
        postContainerElement.insertAdjacentHTML('beforeend', newEmbedCode);
    }

    const scriptElement = document.createElement('script');
    scriptElement.src = './external/assets.tumblr.com/post.js';
    const scriptLoadPromise = new Promise((resolve, reject) => {
        scriptElement.addEventListener('load', event => {
            resolve(event);
        });
        scriptElement.addEventListener('error', event => {
            reject(event);
        });
    });
    document.body.appendChild(scriptElement);
    await scriptLoadPromise;

    const buttonElement = document.createElement('button');
    buttonElement.type = 'button';
    buttonElement.innerText = 'Complete';
    document.body.appendChild(buttonElement);
    buttonElement.addEventListener('click', async event => {
        const items: LocalStorageData = {
            postUrlToImages: {}
        };
        await chrome.storage.local.set(items);

        const tabCandidates = await chrome.tabs.query({
            currentWindow: true,
            active: true,
            url: `chrome-extension://${chrome.runtime.id}/index.html`
        });
        if (tabCandidates.length === 0) {
            throw new Error('Failed to get the current tab.');
        }
        if (tabCandidates.length >= 2) {
            throw new Error('Multiple tabs are found.');
        }
        const thisTabId = tabCandidates[0].id!;

        chrome.tabs.remove(thisTabId);
    });
})();

async function queueForReblogging(event: KeyboardEvent): Promise<void> {
    const target = event.target;
    if (target === null) {
        return;
    }

    const postUrl = getLeftMostPostUrlInInnerHtml(target as Element);
    if (postUrl === null) {
        console.warn(`Failed to get the post URL.`);
        return;
    }

    const postUrlToImages = await (async () => {
        const items = await chrome.storage.local.get('postUrlToImages') as LocalStorageData;
        return items.postUrlToImages ?? {};
    })();

    if (postUrl in postUrlToImages !== true) {
        throw new Error(`${postUrl}: Not found in \`postUrlToImages\`.`);
    }
    const images = postUrlToImages[postUrl];
    if (images.length === 0) {
        console.assert(images.length >= 1);
        return;
    }

    const imageUrls = images.map(x => x.imageUrl);
    let allFound = true;
    for (const imageUrl of imageUrls) {
        const items = await chrome.storage.local.get(imageUrl);
        if (imageUrl in items !== true) {
            allFound = false;
            break;
        }
    }
    if (allFound === true) {
        if (imageUrls.length === 1) {
            console.info(`${postUrl}: The image has been already reblogged.`);
        }
        else {
            console.info(`${postUrl}: All the images have been already reblogged.`);
        }
        return;
    }

    const items = await chrome.storage.local.get('reblogQueue') as LocalStorageData;
    if (items.reblogQueue === undefined) {
        items.reblogQueue = [];
    }
    items.reblogQueue.push({
        postUrl: postUrl,
        images: images
    });
    await chrome.storage.local.set(items);

    console.info(`${postUrl}: Queued for reblogging.`);
}

document.addEventListener('keydown', event => {
    if (event.shiftKey) {
        return;
    }
    if (event.ctrlKey) {
        return;
    }
    if (event.altKey) {
        return;
    }
    if (event.metaKey) {
        return;
    }
    if (event.code !== 'KeyJ') {
        return;
    }

    if (document.activeElement === null || document.activeElement.parentElement?.id !== 'main') {
        if (document.body.children.length === 0) {
            return;
        }

        const scrollY = window.scrollY;
        let element = document.body.children[0];
        while (element.getBoundingClientRect().top < scrollY) {
            if (element.nextElementSibling === null) {
                break;
            }
            element = element.nextElementSibling;
        }
        element.scrollIntoView();
        // If the following cast fails, it is very likely that the design of the
        // DOM structure in `index.html` has been changed, causing a divergence
        // from the logic of this script.
        (element as HTMLElement).focus();
        return;
    }

    if (document.activeElement.nextElementSibling === null) {
        return;
    }

    const element = document.activeElement.nextElementSibling;
    element.scrollIntoView();
    // If the following cast fails, it is very likely that the design of the DOM
    // structure in `index.html` has been changed, causing a divergence from the
    // logic of this script.
    (element as HTMLElement).focus();
});

document.addEventListener('keydown', event => {
    if (event.shiftKey) {
        return;
    }
    if (event.ctrlKey) {
        return;
    }
    if (event.altKey) {
        return;
    }
    if (event.metaKey) {
        return;
    }
    if (event.code !== 'KeyK') {
        return;
    }

    if (document.activeElement === null || document.activeElement.parentElement?.id !== 'main') {
        if (document.body.children.length === 0) {
            return;
        }

        const scrollY = window.scrollY;
        let element = document.body.children[0];
        while (element.getBoundingClientRect().top >= scrollY) {
            if (element.previousElementSibling === null) {
                break;
            }
            element = element.previousElementSibling;
        }
        element.scrollIntoView();
        // If the following cast fails, it is very likely that the design of the
        // DOM structure in `index.html` has been changed, causing a divergence
        // from the logic of this script.
        (element as HTMLElement).focus();
        return;
    }

    if (document.activeElement.previousElementSibling === null) {
        return;
    }

    const element = document.activeElement.previousElementSibling;
    element.scrollIntoView();
    // If the following cast fails, it is very likely that the design of the DOM
    // structure in `index.html` has been changed, causing a divergence from the
    // logic of this script.
    (element as HTMLElement).focus();
});

document.addEventListener('keydown', async event => {
    if (event.shiftKey) {
        return;
    }
    if (event.ctrlKey) {
        return;
    }
    if (event.altKey) {
        return;
    }
    if (event.metaKey) {
        return;
    }
    if (event.code !== 'KeyR') {
        return;
    }

    queueForReblogging(event);
});
