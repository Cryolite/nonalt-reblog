import { getLeftMostPostUrlInInnerHtml, sendMessageToExtension } from "./common.js";
import { createTab, executeScript } from "./background/common.js";

(async () => {
    const postUrls = await (async () => {
        const result = await sendMessageToExtension({
            type: 'loadPostUrlToImages'
        });
        if (result.errorMessage !== null) {
            throw new Error(result.errorMessage);
        }
        const postUrlToImages = result.postUrlToImages;
        const postUrls = Object.keys(postUrlToImages);

        const pattern = /\d+$/;
        const compareFunction = (lhs, rhs) => {
            lhs = pattern.exec(lhs);
            lhs = parseInt(lhs, 10);
            rhs = pattern.exec(rhs);
            rhs = parseInt(rhs, 10);
            return lhs - rhs;
        };
        postUrls.sort(compareFunction);
        return postUrls;
    })();

    for (const [index, postUrl] of postUrls.entries()) {
        const embedUrl = `${postUrl}/embed`;

        const newTab = await createTab({
            url: embedUrl,
            active: false
        });
        const embedCode = await executeScript({
            target: {
                tabId: newTab.id
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
                if (element.nodeName.toUpperCase() !== 'TEXTAREA') {
                    return null;
                }
                return element.value;
            }
        });
        await chrome.tabs.remove(newTab.id);
        if (embedCode === null) {
            console.error(`${embedUrl}: Failed to get the embed code.`);
            continue;
        }

        document.body.insertAdjacentHTML('beforeend', `<div tabindex="${index}"><a href="${postUrl}" style="display: none;"></a></div>`);
        const postContainerElement = document.body.children[document.body.children.length - 1];

        const newEmbedCode = embedCode.replace(/\\x3Cscript\s.+?<\/script>/, '')
        postContainerElement.insertAdjacentHTML('beforeend', newEmbedCode);
    }

    const scriptElement = document.createElement('script');
    scriptElement.async = true;
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
        const items = {};
        items['postUrlToImages'] = {};
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
        const thisTabId = tabCandidates[0].id;
    
        chrome.tabs.remove(thisTabId);
    });
})();

async function queueForReblogging(event) {
    const target = event.target;
    if (target === null) {
        return;
    }

    const postUrl = getLeftMostPostUrlInInnerHtml(target);
    if (typeof postUrl !== 'string') {
        console.warn(`Failed to get the post URL.`);
        return;
    }

    const postUrlToImages = await (async () => {
        const items = await chrome.storage.local.get('postUrlToImages');
        if ('postUrlToImages' in items !== true) {
            return {};
        }
        return items.postUrlToImages;
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

    const items = await chrome.storage.local.get('reblogQueue');
    if ('reblogQueue' in items !== true) {
        items['reblogQueue'] = [];
    }
    items['reblogQueue'].push({
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
    if (event.sourceCapabilities === null) {
        return;
    }

    if (document.activeElement === null) {
        if (document.body.children.length === 0) {
            return;
        }
        const element = document.body.children[0];
        element.scrollIntoView();
        element.focus();
        return;
    }

    if (document.activeElement.parentElement.id !== "main") {
        if (document.body.children.length === 0) {
            return;
        }
        const element = document.body.children[0];
        element.scrollIntoView();
        element.focus();
        return;
    }

    if (document.activeElement.nextElementSibling === null) {
        return;
    }

    const element = document.activeElement.nextElementSibling;
    element.scrollIntoView();
    element.focus();
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
    if (event.sourceCapabilities === null) {
        return;
    }

    if (document.activeElement === null) {
        return;
    }

    if (document.activeElement.parentElement !== document.body) {
        return;
    }

    if (document.activeElement.previousElementSibling === null) {
        return;
    }

    const element = document.activeElement.previousElementSibling;
    element.scrollIntoView();
    element.focus();
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
    if (event.sourceCapabilities === null) {
        return;
    }

    queueForReblogging(event);
});
