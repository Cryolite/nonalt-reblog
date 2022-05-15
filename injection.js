// In order to avoid name conflicts, all global variables used in this injected
// script are defined as a property of the object `window.nonaltReblog`.
if ('nonaltReblog' in window === false) {
    // The presence of `window.nonaltReblog` determines whether this script has
    // been already injected into this page or not.
    nonaltReblog = {};
}
nonaltReblog.tabId = null;
nonaltReblog.extensionId = null;
nonaltReblog.preflight = false;
nonaltReblog.postUrlPattern = /^(https:\/\/[^\/]+\/post\/(\d+))(?:\/.*)?$/;
nonaltReblog.imageUrlChecks = {};
nonaltReblog.postUrlToImageUrls = {};
nonaltReblog.activeElement = null;

async function sleep(milliseconds) {
    if (typeof milliseconds !== 'number') {
        console.assert(typeof milliseconds === 'number', typeof milliseconds);
        throw new Error(`${typeof milliseconds}: An invalid type.`);
    }

    const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, milliseconds);
    });
    return promise;
}

nonaltReblog.sendMessageToExtension = message => {
    const promise = new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(nonaltReblog.extensionId, message, result => {
            if (result === undefined) {
                const lastError = JSON.stringify(chrome.runtime.lastError);
                console.error(lastError);
                reject(new Error(lastError));
                return;
            }
            resolve(result);
            return;
        });
    });
    return promise;
}

nonaltReblog.moveToNextPost = async postElement => {
    const nextPostElement = postElement.nextElementSibling;
    if (typeof nextPostElement === 'undefined') {
        const errorMessage = '`postElement.nextElementSibling` is `undefined`.';
        console.error(errorMessage);
        throw new Error(errorMessage);
    }

    if (nextPostElement !== null) {
        if (typeof nextPostElement !== 'object') {
            console.assert(typeof nextPostElement === 'object', typeof nextPostElement);
            throw new Error(`${typeof nextPostElement}: An invalid type.`)
        }
        nextPostElement.focus();
        return nextPostElement;
    }

    {
        const keyboardEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'j',
            code: 'KeyJ'
        });
        postElement.dispatchEvent(keyboardEvent);
    }

    while (true) {
        const nextPostElement = postElement.nextElementSibling;
        if (nextPostElement !== null) {
            if (typeof nextPostElement !== 'object') {
                console.assert(typeof nextPostElement === 'object', typeof nextPostElement);
                throw new Error(`${typeof nextPostElement}: An invalid type.`)
            }
            nextPostElement.focus();
            return nextPostElement;
        }
        await sleep(1000);
    }
}

nonaltReblog.getLeftMostPostUrlInInnerHtml = element => {
    matchHrefAgaintPostUrl: {
        if (typeof element.nodeName !== 'string') {
            break matchHrefAgaintPostUrl;
        }
        const name = element.nodeName.toUpperCase();
        if (name !== 'A') {
            break matchHrefAgaintPostUrl;
        }

        const href = element.href;
        if (typeof href !== 'string') {
            break matchHrefAgaintPostUrl;
        }

        const matches = nonaltReblog.postUrlPattern.exec(href);
        if (!Array.isArray(matches)) {
            break matchHrefAgaintPostUrl;
        }

        return matches[1];
    }

    const children = element.children;
    if (typeof children !== 'object') {
        return null;
    }
    for (const child of children) {
        const result = nonaltReblog.getLeftMostPostUrlInInnerHtml(child);
        if (typeof result === 'string') {
            return result;
        }
    }

    return null;
}

nonaltReblog.getHrefsInInnerHtml = element => {
    function impl(element, hrefs) {
        matchHrefAgaintPostUrl: {
            if (typeof element.nodeName !== 'string') {
                break matchHrefAgaintPostUrl;
            }
            const name = element.nodeName.toUpperCase();
            if (name !== 'A') {
                break matchHrefAgaintPostUrl;
            }

            const href = element.href;
            if (typeof href !== 'string') {
                break matchHrefAgaintPostUrl;
            }

            hrefs.push(href);
            break matchHrefAgaintPostUrl;
        }

        const children = element.children;
        if (typeof children !== 'object') {
            return;
        }
        for (const child of children) {
            impl(child, hrefs);
        }
    }

    const hrefs = [];
    impl(element, hrefs);
    return [...new Set(hrefs)];
}

nonaltReblog.initiatePreflight = async () => {
    if (nonaltReblog.activeElement === null) {
        console.error('Press the `J` key (and possibly the `K` key afterwards) to set the starting position of preflight.')
        return;
    }
    let element = nonaltReblog.activeElement;

    while (nonaltReblog.preflight) {
        const postUrl = nonaltReblog.getLeftMostPostUrlInInnerHtml(element);
        if (postUrl === null) {
            console.info('Removed because any post URL could not be identified.');
            const nextElement = await nonaltReblog.moveToNextPost(element);
            element.remove();
            element = nextElement;
            element.focus();
            continue;
        }

        const hrefs = nonaltReblog.getHrefsInInnerHtml(element);
        const innerText = element.innerText;

        {
            const myAccountPattern = /^https:\/\/cryolite\.tumblr\.com/;
            let skip = false;
            for (const href of hrefs) {
                if (href.search(myAccountPattern) !== -1) {
                    console.info(`${postUrl}: Removed because this is my post or reblogged by me.`);
                    const nextElement = await nonaltReblog.moveToNextPost(element);
                    element.remove();
                    element = nextElement;
                    element.focus();
                    skip = true;
                    break;
                }
            }
            if (skip === true) {
                continue;
            }
        }

        const result = await nonaltReblog.sendMessageToExtension({
            type: 'getImageUrls',
            tabId: nonaltReblog.tabId,
            hrefs: hrefs,
            innerText: innerText
        });
        if (result.errorMessage !== null) {
            console.error(result.errorMessage);
            nonaltReblog.preflight = false;
            return;
        }
        const imageUrls = result.imageUrls;
        if (!Array.isArray(imageUrls)) {
            console.assert(Array.isArray(imageUrls), typeof imageUrls);
            nonaltReblog.preflight = false;
            return;
        }
        for (const imageUrl of imageUrls) {
            if (typeof imageUrl !== 'string') {
                console.assert(typeof imageUrl === 'string', typeof imageUrl);
                nonaltReblog.preflight = false;
                return;
            }
        }

        if (imageUrls.length === 0) {
            console.warn(`${postUrl}: Removed because any image URL could not be identified.`);
            const nextElement = await nonaltReblog.moveToNextPost(element);
            element.remove();
            element = nextElement;
            element.focus();
            continue;
        }
        else if (imageUrls.length === 1) {
            let allDuplicated = true;
            for (const imageUrl of imageUrls) {
                checkForDuplication: {
                    if (imageUrl in nonaltReblog.imageUrlChecks) {
                        if (nonaltReblog.imageUrlChecks[imageUrl] === postUrl) {
                            nonaltReblog.preflight = false;
                            console.assert(nonaltReblog.imageUrlChecks[imageUrl] !== postUrl, postUrl);
                            return;
                        }
                        break checkForDuplication;
                    }

                    nonaltReblog.imageUrlChecks[imageUrl] = postUrl;

                    const result = await nonaltReblog.sendMessageToExtension({
                        type: 'findInLocalStorage',
                        key: imageUrl
                    });
                    if (result.errorMessage !== null) {
                        nonaltReblog.preflight = false;
                        console.error(result.errorMessage);
                        throw new Error(result.errorMessage);
                    }
                    if (result.found === true) {
                        break checkForDuplication;
                    }

                    allDuplicated = false;
                    break checkForDuplication;
                }
                if (allDuplicated === false) {
                    break;
                }
            }
            if (allDuplicated === true) {
                console.info(`${postUrl}: Removed because the image has been already detected in the dashboard or reblogged.`);
                const nextElement = await nonaltReblog.moveToNextPost(element);
                element.remove();
                element = nextElement;
                element.focus();
                continue;
            }
            else {
                console.info(`${postUrl}: ${JSON.stringify(imageUrls)}`);
                nonaltReblog.postUrlToImageUrls[postUrl] = imageUrls;
            }
        }
        else {
            console.warn(`${postUrl}: Removed because multiple image URLs were identified (TODO).`);
            const nextElement = await nonaltReblog.moveToNextPost(element);
            element.remove();
            element = nextElement;
            element.focus();
            continue;
        }

        element = await nonaltReblog.moveToNextPost(element);
    }
}

nonaltReblog.queueForReblogging = async event => {
    const target = event.target;
    if (target === null) {
        return;
    }

    const postUrl = nonaltReblog.getLeftMostPostUrlInInnerHtml(target);
    if (typeof postUrl !== 'string') {
        console.warn(`Failed to get the post URL.`);
        return;
    }

    if (postUrl in nonaltReblog.postUrlToImageUrls === false) {
        console.warn(`${postUrl}: Execute preflight first.`);
        return;
    }
    const imageUrls = nonaltReblog.postUrlToImageUrls[postUrl];
    if (imageUrls.length === 0) {
        console.assert(imageUrls.length >= 1);
        return;
    }

    let allFound = true;
    for (const imageUrl of imageUrls) {
        const result = await nonaltReblog.sendMessageToExtension({
            type: 'findInLocalStorage',
            key: imageUrl
        });
        if (result.errorMessage !== null) {
            console.error(result.errorMessage);
            return;
        }
        const found = result.found;
        if (typeof found !== 'boolean') {
            console.error(`${typeof found}: An invalid type.`);
            return;
        }
        if (found === false) {
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

    nonaltReblog.sendMessageToExtension({
        type: 'queueForReblogging',
        tabId: nonaltReblog.tabId,
        postUrl: postUrl,
        imageUrls: imageUrls
    });
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
    if (nonaltReblog.preflight === true) {
        return;
    }
    if (document.activeElement === null) {
        return;
    }

    nonaltReblog.activeElement = document.activeElement;
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
    if (nonaltReblog.preflight === true) {
        return;
    }
    if (document.activeElement === null) {
        return;
    }
    if (nonaltReblog.activeElement === null) {
        return;
    }

    if (document.activeElement == nonaltReblog.activeElement.previousElementSibling) {
        nonaltReblog.activeElement = document.activeElement;
        return;
    }

    if (nonaltReblog.activeElement.previousElementSibling !== null) {
        nonaltReblog.activeElement = nonaltReblog.activeElement.previousElementSibling;
        nonaltReblog.activeElement.focus();
    }
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
    if (event.code !== 'KeyP') {
        return;
    }
    if (event.sourceCapabilities === null) {
        return;
    }

    if (nonaltReblog.preflight === false) {
        nonaltReblog.preflight = true;
        nonaltReblog.initiatePreflight().finally(() => {
            nonaltReblog.preflight = false;
        });
        return;
    }

    nonaltReblog.preflight = false;
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
    if (nonaltReblog.preflight === true) {
        return;
    }

    nonaltReblog.queueForReblogging(event);
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
    if (event.code !== 'KeyQ') {
        return;
    }
    if (event.sourceCapabilities === null) {
        return;
    }
    if (nonaltReblog.preflight === true) {
        return;
    }

    nonaltReblog.sendMessageToExtension({
        type: 'dequeueForReblogging',
        tabId: nonaltReblog.tabId
    });
});
