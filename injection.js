// In order to avoid name conflicts, all global variables used in this injected
// script are defined as a property of the object `window.nonaltReblog`.
if ('nonaltReblog' in window === false) {
    nonaltReblog = {};
}
nonaltReblog.extensionId = null;
nonaltReblog.postUrlPattern = /^(https:\/\/[^\/]+\/post\/(\d+))(?:\/.*)?$/;

nonaltReblog.sendMessageToExtension = message => {
    const promise = new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(nonaltReblog.extensionId, message, result => {
            if (result === undefined) {
                const lastError = JSON.stringify(chrome.runtime.lastError);
                reject(new Error(lastError));
                return;
            }
            resolve(result);
            return;
        });
    });
    return promise;
}

nonaltReblog._getPostUrlsFromInnerHtmlImpl = (node, result) => {
    if (typeof node.nodeName === 'string') {
        const name = node.nodeName.toUpperCase();
        if (name === 'A') {
            const href = node.href;
            if (typeof href === 'string') {
                const matches = nonaltReblog.postUrlPattern.exec(href);
                if (Array.isArray(matches)) {
                    result.push(matches[1]);
                    return;
                }
            }
        }
    }

    const children = node.children;
    if (typeof children !== 'object') {
        return null;
    }
    for (const child of children) {
        nonaltReblog._getPostUrlsFromInnerHtmlImpl(child, result);
    }
}

nonaltReblog.getPostUrlsFromInnerHtml = node => {
    const postUrls = [];
    nonaltReblog._getPostUrlsFromInnerHtmlImpl(node, postUrls);
    return postUrls;
}

nonaltReblog.getNewestAndOldestPostUrlsFromInnerHtml = node => {
    const postUrls = nonaltReblog.getPostUrlsFromInnerHtml(node);

    const sortedPostUrls = [];
    for (const postUrl of postUrls) {
        const matches = nonaltReblog.postUrlPattern.exec(postUrl);
        if (!Array.isArray(matches)) {
            throw new Error(`${postUrl}: An invalid post URL.`);
        }
        const postId = BigInt(matches[2]);
        const url = matches[1];
        sortedPostUrls.push([postId, url]);
    }
    sortedPostUrls.sort((x, y) => (x[0] < y[0]) ? -1 : ((x[0] > y[0]) ? 1 : 0));
    if (sortedPostUrls.length === 0) {
        return [null, null];
    }
    const oldestPostUrl = sortedPostUrls[0][1];
    const newestPostUrl = sortedPostUrls[sortedPostUrls.length - 1][1];
    return [newestPostUrl, oldestPostUrl];
}

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

    const target = (() => {
        const target = event.target;
        if (typeof target !== 'object') {
            return;
        }
        const left = target.offsetLeft;
        if (typeof left !== 'number') {
            const error = new Error(`${typeof left}: An invalid type.`);
            console.error(error);
            return;
        }
        const top = target.offsetTop;
        if (typeof top !== 'number') {
            const error = new Error(`${typeof top}: An invalid type.`);
            console.error(error);
            return;
        }
        const width = target.offsetWidth;
        if (typeof width !== 'number') {
            const error = new Error(`${typeof width}: An invalid type.`);
            console.error(error);
            return;
        }
        if (width <= 0) {
            const error = new Error(`${width}: An invalid width.`);
            console.error(error);
            return;
        }
        const height = target.offsetHeight;
        if (typeof height !== 'number') {
            const error = new Error(`${typeof height}: An invalid type.`);
            console.error(error);
            return;
        }
        if (height > 0) {
            return target;
        }

        // When scrolling with the `j` key, an extra `DIV` element with a height
        // of 0 may be inserted. As a workaround for this phenomenon, if
        // `event.target` has a height of 0, the `nextElementSibling` is assumed
        // to be the actual target.
        const nextTarget = target.nextElementSibling;
        if (typeof nextTarget !== 'object') {
            const error = new Error(`${typeof nextTarget}: An invalid type.`);
            console.error(error);
            return;
        }
        const nextLeft = nextTarget.offsetLeft;
        if (typeof nextLeft !== 'number') {
            const error = new Error(`${typeof nextLeft}: An invalid type.`);
            console.error(error);
            return;
        }
        if (nextLeft !== left) {
            const error = new Error(`${nextLeft} != ${left}`);
            console.error(error);
            return;
        }
        const nextTop = nextTarget.offsetTop;
        if (typeof nextTop !== 'number') {
            const error = new Error(`${typeof nextTop}: An invalid type.`);
            console.error(error);
            return;
        }
        if (nextTop !== top) {
            const error = new Error(`${nextTop} != ${top}`);
            console.error(error);
            return;
        }
        const nextWidth = nextTarget.offsetWidth;
        if (typeof nextWidth !== 'number') {
            const error = new Error(`${typeof nextWidth}: An invalid type.`);
            console.error(error);
            return;
        }
        if (nextWidth !== width) {
            const error = new Error(`${nextWidth} != ${width}`);
            console.error(error);
            return;
        }
        const nextHeight = nextTarget.offsetHeight;
        if (typeof nextHeight !== 'number') {
            const error = new Error(`${typeof nextHeight}: An invalid type.`);
            console.error(error);
            return;
        }
        if (nextHeight <= 0) {
            const error = new Error(`${nextHeight}: An invalid height.`);
            console.error(error);
            return;
        }
        return nextTarget;
    })();

    const [postUrl, originalPostUrl] = nonaltReblog.getNewestAndOldestPostUrlsFromInnerHtml(target);
    if (typeof postUrl !== 'string') {
        console.warn(`Failed to get the post URL.`);
        return;
    }
    if (typeof originalPostUrl !== 'string') {
        console.warn(`Failed to get the original post URL.`);
        return;
    }

    {
        const result = await nonaltReblog.sendMessageToExtension({
            'type': 'findInLocalStorage',
            'key': originalPostUrl
        });
        if (result.error_message !== null) {
            throw new Error(result.error_message);
        }
        if (typeof result.found !== 'boolean') {
            throw new Error(`${typeof result.found}: An invalid type for \`result.found\`.`);
        }
        if (result.found) {
            console.info(`Already reblogged (original post URL: ${originalPostUrl}).`);
            return;
        }
    }

    console.info(`Synthesize a press of the key \`Alt+r\` on the post ${postUrl}.`);
    {
        const keyboardEvent = new KeyboardEvent('keydown', {
            'bubbles': true,
            'cancelable': true,
            'key': 'Alt',
            'code': 'AltLeft',
            'location': KeyboardEvent.DOM_KEY_LOCATION_LEFT,
            'altKey': true
        });
        target.dispatchEvent(keyboardEvent);
    }
    {
        const keyboardEvent = new KeyboardEvent('keydown', {
            'bubbles': true,
            'cancelable': true,
            'key': 'r',
            'code': 'KeyR',
            'altKey': true
        });
        target.dispatchEvent(keyboardEvent);
    }

    {
        const result = await nonaltReblog.sendMessageToExtension({
            'type': 'postprocess',
            'post_url': postUrl,
            'original_post_url': originalPostUrl,
            'user_agent': navigator.userAgent
        });
        if (result.error_message === null) {
            console.info(`Confirmed the reblog of the post ${postUrl}.`);
        }
        else {
            console.error(result.error_message);
        }
    }
});
