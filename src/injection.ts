import {
    sleep, getLeftMostPostUrlInInnerHtml, sendMessageToExtension, PreflightOnPostRequest
} from './common';

if ('nonaltReblog' in window === false) {
    // The presence of `window.nonaltReblog` determines whether this script has
    // been already injected into this page or not.
    window.nonaltReblog = {
        // When this script is injected to `https://www.tumblr.com/dashboard`, the tab
        // ID for the page is assigned to the following property.
        tabId: null,
        // Likewise, the extension ID is assigned to the following property.
        extensionId: null,
        activeElement: null,
        preflight: false
    };
}

const nonaltReblog = window.nonaltReblog;

function getHrefsInInnerHtml(element: Element): string[] {
    const impl = (element: Element, hrefs: string[]): void => {
        matchHrefAgaintPostUrl: {
            if (element.nodeName !== 'A') {
                break matchHrefAgaintPostUrl;
            }
            const anchor = element as HTMLAnchorElement;

            const href = anchor.href;
            hrefs.push(href);
            break matchHrefAgaintPostUrl;
        }

        for (const child of element.children) {
            impl(child, hrefs);
        }
    }

    const hrefs: string[] = [];
    impl(element, hrefs);
    return [...new Set(hrefs)];
}

function getPostImageUrls(element: Element): string[] {
    const srcPattern = /^(https:\/\/64\.media\.tumblr\.com\/[0-9a-z]+\/(?:[0-9a-z]+-[0-9a-z]+\/s\d+x\d+\/[0-9a-z]+|tumblr_[0-9A-Za-z]+_\d+)\.(?:jpg|pnj|gifv))\s+(\d+)w$/;

    const impl = (element: Element, imageUrls: string[]): void => {
        findImageUrl: {
            if (element.nodeName !== 'IMG') {
                break findImageUrl;
            }
            const img = element as HTMLImageElement;

            const srcset = img.srcset;

            const imageUrl = (() => {
                const srcs = srcset.split(',');
                let maxWidth = 0;
                let imageUrl = null;
                for (const src of srcs) {
                    const matches = srcPattern.exec(src.trim());
                    if (matches === null) {
                        continue;
                    }
                    const width = parseInt(matches[2], 10);
                    if (width > maxWidth) {
                        imageUrl = matches[1];
                    }
                }
                return imageUrl;
            })();
            if (imageUrl !== null) {
                imageUrls.push(imageUrl);
            }
        }

        for (const child of element.children) {
            impl(child, imageUrls);
        }
    };

    const imageUrls: string[] = [];
    impl(element, imageUrls);
    return [...new Set(imageUrls)];
}

const POST_IMAGE_URLS = new Set<string>();
const IMAGE_URLS = new Set<string>();
const MESSAGES: PreflightOnPostRequest[] = [];

async function initiatePreflight() {
    if (nonaltReblog.activeElement === null) {
        console.error('Press the `J` key (and possibly the `K` key afterwards) to set the starting position of preflight.')
        return;
    }
    let postElement = nonaltReblog.activeElement;

    const dequeueMessages = async () => {
        while (MESSAGES.length >= 1) {
            console.info(`Message #${MESSAGES.length}`);

            const message = MESSAGES[0];
            MESSAGES.shift();
            message.imageUrls = [...IMAGE_URLS];
            const result = await sendMessageToExtension(nonaltReblog.extensionId!, message);
            if (result.errorMessage !== null) {
                throw Error(result.errorMessage);
            }
            for (const imageUrl of result.imageUrls) {
                IMAGE_URLS.add(imageUrl);
            }
        }
    };

    if (MESSAGES.length >= 1) {
        await dequeueMessages();
        nonaltReblog.preflight = false;
        return;
    }

    let preflightPromise = null;
    const deadline = Date.now() + 1 * 60 * 60 * 1000;
    while (nonaltReblog.preflight && Date.now() <= deadline) {
        while (postElement.nextElementSibling !== null) {
            const previousPostElement = postElement;
            postElement = postElement.nextElementSibling;
            postElement.scrollIntoView();

            const postUrl = getLeftMostPostUrlInInnerHtml(previousPostElement);
            if (postUrl === null) {
                console.info('Removed because any post URL could not be identified.');
                previousPostElement.remove();
                continue;
            }

            const hrefs = getHrefsInInnerHtml(previousPostElement);
            // The following cast is based on the DOM structure of
            // `www.tumblr.com/dashboard` as of 2022/07. Therefore, if this cast
            // fails, it is very likely that the DOM structure has changed and
            // deviates from the logic of this script. In this case, the DOM
            // structure of `www.tumblr.com/dashboard` should be re-examined.
            const innerText = (previousPostElement as HTMLElement).innerText;

            {
                const myAccountPattern = /^https:\/\/cryolite\.tumblr\.com/;
                let skip = false;
                for (const href of hrefs) {
                    if (myAccountPattern.test(href) === true) {
                        skip = true;
                        break;
                    }
                }
                if (skip === true) {
                    console.info(`${postUrl}: Removed because this is my post or reblogged by me.`);
                    previousPostElement.remove();
                    continue;
                }
            }

            const postImageUrls = getPostImageUrls(previousPostElement);
            if (postImageUrls.length === 0) {
                console.warn(`${postUrl}: Removed because any post image URL could not be identified.`);
                previousPostElement.remove();
                continue;
            }

            {
                let allDetected = true;
                for (const postImageUrl of postImageUrls) {
                    if (POST_IMAGE_URLS.has(postImageUrl) !== true) {
                        allDetected = false;
                        break;
                    }
                }
                if (allDetected === true) {
                    console.info(`${postUrl}: Already detected in the dashboard.`);
                    previousPostElement.remove();
                    continue;
                }
            }

            MESSAGES.push({
                type: 'preflightOnPost',
                tabId: nonaltReblog.tabId!,
                postUrl: postUrl,
                postImageUrls: postImageUrls,
                hrefs: hrefs,
                innerText: innerText,
                // TODO: Check if it's right to set this field.
                imageUrls: []
            });
            previousPostElement.remove();

            for (const postImageUrl of postImageUrls) {
                POST_IMAGE_URLS.add(postImageUrl);
            }
        }

        const sleepDeadline = Date.now() + 1000;
        while (true) {
            if (MESSAGES.length >= 1 && preflightPromise === null) {
                const message = MESSAGES[0];
                MESSAGES.shift();
                message.imageUrls = [...IMAGE_URLS];
                preflightPromise = sendMessageToExtension(nonaltReblog.extensionId!, message);
            }

            if (Date.now() > sleepDeadline) {
                break;
            }

            const eventMultiplexer = [];
            if (preflightPromise !== null) {
                eventMultiplexer.push(preflightPromise);
            }
            const sleepPromise = sleep(Math.max(sleepDeadline - Date.now(), 0));
            eventMultiplexer.push(sleepPromise);

            const result = await Promise.race(eventMultiplexer);
            if (typeof result === 'object') {
                if (result.errorMessage !== null) {
                    throw Error(result.errorMessage);
                }
                for (const imageUrl of result.imageUrls) {
                    IMAGE_URLS.add(imageUrl);
                }
                preflightPromise = null;
                continue;
            }
        }
    }
    if (preflightPromise !== null) {
        const result = await preflightPromise;
        if (result.errorMessage !== null) {
            throw Error(result.errorMessage);
        }
        for (const imageUrl of result.imageUrls) {
            IMAGE_URLS.add(imageUrl);
        }
        preflightPromise = null;
    }

    await dequeueMessages();

    nonaltReblog.preflight = false;
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
    if (nonaltReblog.preflight === true) {
        return;
    }
    if (document.activeElement === null) {
        return;
    }

    nonaltReblog.preflight = false;
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
    if (nonaltReblog.preflight === true) {
        return;
    }
    if (document.activeElement === null) {
        return;
    }
    if (nonaltReblog.activeElement === null) {
        return;
    }

    nonaltReblog.preflight = false;

    if (document.activeElement == nonaltReblog.activeElement.previousElementSibling) {
        nonaltReblog.activeElement = document.activeElement;
        return;
    }

    if (nonaltReblog.activeElement.previousElementSibling !== null) {
        nonaltReblog.activeElement = nonaltReblog.activeElement.previousElementSibling;
        // The following cast is based on the DOM structure of
        // `www.tumblr.com/dashboard` as of 2022/07. Therefore, if this cast
        // fails, it is very likely that the DOM structure has changed and
        // deviates from the logic of this script. In this case, the DOM
        // structure of `www.tumblr.com/dashboard` should be re-examined.
        (nonaltReblog.activeElement as HTMLElement).focus();
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

    if (nonaltReblog.preflight === false) {
        nonaltReblog.preflight = true;
        const startTime = Math.floor(Date.now() / 1000);
        initiatePreflight().finally(() => {
            nonaltReblog.preflight = false;

            let elapsedSeconds = Math.floor(Date.now() / 1000) - startTime;
            const elapsedHours = Math.floor(elapsedSeconds / 3600);
            elapsedSeconds -= elapsedHours * 3600;
            const elapsedMinutes = Math.floor(elapsedSeconds / 60);
            elapsedSeconds -= elapsedMinutes * 60;
            console.info(`Elapsed time: ${elapsedHours}:${elapsedMinutes}:${elapsedSeconds}`);
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
    if (event.code !== 'KeyQ') {
        return;
    }
    if (nonaltReblog.preflight === true) {
        return;
    }

    sendMessageToExtension(nonaltReblog.extensionId!, {
        type: 'dequeueForReblogging',
        tabId: nonaltReblog.tabId!
    });
});
