import { sleep, fetchImages } from '../common.js'
import { executeScript, createTab } from '../background/common.js'

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

    const artistUrl = (() => {
        const pattern = /^https:\/\/twitter\.com\/[0-9A-Z_a-z]+/;
        const match = pattern.exec(sourceUrl);
        if (Array.isArray(match) !== true) {
            throw new Error(`${sourceUrl}: An invalid source URL.`);
        }
        return match[0];
    })();

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
        newImage.artistUrl = artistUrl;
        images.push(newImage);
    }

    chrome.tabs.remove(newTab.id);
}

export async function getImages(tabId, hrefs, innerText) {
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
        const sourceUrlPattern = /https:\/\/twitter\.com\/[^\/]+\/status\/\d+/g;
        const matches = innerText.matchAll(sourceUrlPattern);
        for (const match of matches) {
            sourceUrls.push(match[0]);
        }
    }
    {
        const shortUrlPattern = /https:\/\/t\.co\/[0-9A-Za-z]+/g;
        const shortMatches = innerText.matchAll(shortUrlPattern);
        for (const shortMatch of shortMatches) {
            const sourceUrl = await followTwitterShortUrl(shortMatch[0]);
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
