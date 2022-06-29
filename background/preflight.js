import { fetchImages } from '../common.js';
import { printWarning, printError } from '../background/common.js';
import * as pixiv from '../services/pixiv.js';
import * as twitter from '../services/twitter.js';

const serviceModules = [pixiv, twitter];

async function getImages(tabId, hrefs, innerText) {
    for (const serviceModule of serviceModules) {
        const images = await serviceModule.getImages(tabId, hrefs, innerText);
        if (images.length >= 1) {
            return images;
        }
    }
    return [];
}

async function matchImages(tabId, postUrl, postImages, images) {
    const requestBody = {
        sources: postImages,
        targets: images
    }
    const response = await fetch('http://localhost:5000/match', {
        method: 'POST',
        headers: {
            Accept: 'application/json, text/html',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });
    if (response.ok !== true) {
        throw new Error(`Failed to connect \`matcher\` (${response.status}).\n${await response.text()}`);
    }

    const responseBody = await response.text();
    const matchResults = JSON.parse(responseBody);
    if (Array.isArray(matchResults) !== true) {
        throw new Error(`${typeof matchResults}`);
    }
    if (matchResults.length !== postImages.length) {
        throw new Error(`${matchResults.length} != ${postImages.length}`);
    }

    const matchedImages = [];
    for (let i = 0; i < postImages.length; ++i) {
        const matchResult = matchResults[i];
        if (typeof matchResult.index !== 'number') {
            throw new Error(`${typeof matchResult.index}`);
        }
        if (matchResult.index < 0 || images.length <= matchResult.index) {
            throw new Error(`${matchResult.index}`);
        }
        if (typeof matchResult.score !== 'number') {
            throw new Error(`${typeof matchResult.score}`);
        }
        if (matchResult.score < 0.0 || 1.0 < matchResult.score) {
            throw new Error(`${matchResult.score}`);
        }

        const matchedImage = images[matchResult.index];
        const matchedImageUrl = matchedImage.imageUrl;
        const matchScore = matchResult.score;
        if (matchScore < 0.99) {
            printError(tabId, `${postUrl}: Does not match to any image. A candidate is ${matchedImageUrl} (${matchScore}).`);
            return null;
        }
        matchedImages.push(matchedImage);
    }
    return matchedImages;
}

async function preflightOnPostImpl(tabId, postUrl, postImageUrls, hrefs, innerText, sendResponse)
{
    if (postImageUrls.length === 0) {
        throw new Error('postImageUrls.length === 0');
    }
    const postImages = await fetchImages(postImageUrls, postUrl);

    const images = await getImages(tabId, hrefs, innerText);
    if (images.length === 0) {
        printWarning(tabId, `${postUrl}: Removed because any image URL could not be identified.`);
        sendResponse({
            errorMessage: null,
            postUrl: postUrl,
            matchedImages: null
        });
        return;
    }

    const matchedImages = await matchImages(tabId, postUrl, postImages, images);
    if (Array.isArray(matchedImages) !== true) {
        sendResponse({
            errorMessage: null,
            postUrl: postUrl,
            matchedImages: null
        });
        return;
    }

    const matchedImageUrls = matchedImages.map(x => x.imageUrl);
    if ([...new Set(matchedImageUrls)].length != postImageUrls.length) {
        printError(tabId, `${postUrl}: Multiple post images match to the same target image.`);
        sendResponse({
            errorMessage: null,
            postUrl: postUrl,
            matchedImages: null
        });
        return;
    }

    sendResponse({
        errorMessage: null,
        postUrl: postUrl,
        matchedImages: matchedImages
    });
}

export function preflightOnPost(tabId, postUrl, postImageUrls, hrefs, innerText, sendResponse)
{
    try {
        preflightOnPostImpl(tabId, postUrl, postImageUrls, hrefs, innerText, sendResponse);
    } catch (error) {
        sendResponse({
            errorMessage: error.message,
            postUrl: postUrl,
            matchImages: null
        });
    }
}
