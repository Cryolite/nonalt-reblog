import { fetchImages, PostImage, LocalStorageData, PreflightOnPostResponse, Image } from '../common';
import { printInfo, printWarning, printError } from './common';
import * as pixiv from '../services/pixiv';
import * as twitter from '../services/twitter';

const SERVICE_MODULES = [pixiv, twitter];

async function getImages(tabId: number, hrefs: string[], innerText: string): Promise<Image[]> {
    for (const serviceModule of SERVICE_MODULES) {
        const images = await serviceModule.getImages(tabId, hrefs, innerText);
        if (images.length >= 1) {
            return images;
        }
    }
    return [];
}

async function matchImages(tabId: number, postUrl: string, postImages: PostImage[], images: Image[]): Promise<Image[] | null> {
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
            printWarning(tabId, `${postUrl}: Does not match to any image. A candidate is ${matchedImageUrl} (${matchScore}).`);
            return null;
        }
        matchedImages.push(matchedImage);
    }
    return matchedImages;
}

async function findInReblogQueue(imageUrl: string): Promise<boolean> {
    const items = await chrome.storage.local.get('reblogQueue') as LocalStorageData;
    if (items.reblogQueue === undefined) {
        return false;
    }
    const reblogQueue = items.reblogQueue;

    const imageUrls = reblogQueue.map(x => x.images).flat().map(x => x.imageUrl);
    return imageUrls.includes(imageUrl);
}

async function findInLocalStorage(imageUrl: string): Promise<boolean> {
    const items = await chrome.storage.local.get(imageUrl) as LocalStorageData;
    return imageUrl in items;
}

async function addEntryToPostUrlToImages(postUrl: string, images: Image[]): Promise<void> {
    const items = await chrome.storage.local.get('postUrlToImages') as LocalStorageData;
    if (items.postUrlToImages === undefined) {
        items.postUrlToImages = {};
    }
    items.postUrlToImages[postUrl] = images;
    await chrome.storage.local.set(items);
}

async function preflightOnPostImpl(tabId: number, postUrl: string, postImageUrls: string[], hrefs: string[], innerText: string, imageUrls: string[], sendResponse: (message: PreflightOnPostResponse) => void): Promise<void>
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
            imageUrls: []
        });
        return;
    }

    const matchedImages = await matchImages(tabId, postUrl, postImages, images);
    if (matchedImages === null) {
        sendResponse({
            errorMessage: null,
            imageUrls: []
        });
        return;
    }

    const matchedImageUrls = matchedImages.map(x => x.imageUrl);
    if ([...new Set(matchedImageUrls)].length != postImageUrls.length) {
        printWarning(tabId, `${postUrl}: Multiple post images match to the same target image.`);
        sendResponse({
            errorMessage: null,
            imageUrls: []
        });
        return;
    }

    let allDuplicated = true;
    for (const imageUrl of matchedImageUrls) {
        checkForDuplication: {
            if (imageUrls.includes(imageUrl) === true) {
                printInfo(tabId, `${imageUrl}: Already detected in the dashboard.`);
                break checkForDuplication;
            }

            imageUrls.push(imageUrl);

            if (await findInReblogQueue(imageUrl) === true) {
                printInfo(tabId, `${imageUrl}: Already queued to be reblogged.`);
                break checkForDuplication;
            }

            if (await findInLocalStorage(imageUrl) === true) {
                printInfo(tabId, `${imageUrl}: Already reblogged.`);
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
        printInfo(tabId, `  => ${postUrl}: Removed.`);
        sendResponse({
            errorMessage: null,
            imageUrls: []
        });
        return;
    }

    printInfo(tabId, `${postUrl}: ${JSON.stringify(matchedImageUrls)}`);
    {
        const images = matchedImages.map(x => {
            return {
                artistUrl: x.artistUrl,
                imageUrl: x.imageUrl
            };
        });
        // TODO: Consider awaiting here.
        addEntryToPostUrlToImages(postUrl, images);
    }

    sendResponse({
        errorMessage: null,
        imageUrls: matchedImageUrls
    });
}

export function preflightOnPost(tabId: number, postUrl: string, postImageUrls: string[], hrefs: string[], innerText: string, imageUrls: string[], sendResponse: (message: PreflightOnPostResponse) => void): void
{
    try {
        // TODO: This function call returns a promise, thus never throws.
        preflightOnPostImpl(tabId, postUrl, postImageUrls, hrefs, innerText, imageUrls, sendResponse);
    } catch (error) {
        printError(tabId, `A fatal error in \`preflightOnPost\`: ${error}`);
        throw error;
    }
}
