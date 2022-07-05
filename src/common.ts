export interface PostImage {
    imageUrl: string;
    mime: string | null;
    blob: string;
}

export interface Image {
    imageUrl: string;
    artistUrl: string;
}

export interface ReblogQueue {
    postUrl: string;
    images: Image[];
}

export interface LocalStorageData {
    // TODO: Consider storing image URLs in a subitem.
    [imageUrl: string]: Date | ReblogQueue[] | Record<string, Image[]> | undefined;
    reblogQueue?: ReblogQueue[];
    postUrlToImages?: Record<string, Image[]>;
}

export async function sleep(milliseconds: number): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, milliseconds);
    });
    return promise;
}

const POST_URL_PATTERN = /^(https:\/\/[^\/]+\/post\/(\d+))(?:\/.*)?$/;

export function getLeftMostPostUrlInInnerHtml(element: Element): string | null {
    matchHrefAgaintPostUrl: {
        if (element.nodeName !== 'A') {
            break matchHrefAgaintPostUrl;
        }
        const anchor = element as HTMLAnchorElement;

        const href = anchor.href;
        const matches = POST_URL_PATTERN.exec(href);
        if (matches === null) {
            break matchHrefAgaintPostUrl;
        }

        return matches[1];
    }

    for (const child of element.children) {
        const result = getLeftMostPostUrlInInnerHtml(child);
        if (result !== null) {
            return result;
        }
    }

    return null;
}

export interface LoadPostUrlToImagesRequest {
    type: 'loadPostUrlToImages';
}

export interface LoadPostUrlToImagesResponse {
    errorMessage: string | null;
    postUrlToImages: Record<string, Image[]>;
}

export interface QueueForRebloggingRequest {
    type: 'queueForReblogging';
    tabId: number;
    postUrl: string;
    images: Image[];
}

export interface QueueForRebloggingResponse {
    errorMessage: string | null;
}

export interface DequeueForRebloggingRequest {
    type: 'dequeueForReblogging';
    tabId: number;
}

export interface DequeueForRebloggingResponse {
    errorMessage: string | null;
}

export interface PreflightOnPostRequest {
    type: 'preflightOnPost';
    tabId: number;
    postUrl: string;
    postImageUrls: string[];
    hrefs: string[];
    innerText: string;
    imageUrls: string[];
}

export interface PreflightOnPostResponse {
    errorMessage: string | null;
    imageUrls: string[];
}

export type RequestTypes =
    | LoadPostUrlToImagesRequest
    | QueueForRebloggingRequest
    | DequeueForRebloggingRequest
    | PreflightOnPostRequest;

export type ResponseTypes =
    | LoadPostUrlToImagesResponse
    | QueueForRebloggingResponse
    | DequeueForRebloggingResponse
    | PreflightOnPostResponse;

type ResponseFor<Request extends RequestTypes> =
    Request extends LoadPostUrlToImagesRequest ? LoadPostUrlToImagesResponse :
    Request extends QueueForRebloggingRequest ? QueueForRebloggingResponse :
    Request extends DequeueForRebloggingRequest ? DequeueForRebloggingResponse :
    Request extends PreflightOnPostRequest ? PreflightOnPostResponse :
    never;

export function sendMessageToExtension<Request extends RequestTypes>(extensionId: string, message: Request): Promise<ResponseFor<Request>> {
    const promise = new Promise<ResponseFor<Request>>((resolve, reject) => {
        chrome.runtime.sendMessage(extensionId, message, result => {
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

interface Fetcher {
    (url: string, referrer: string): Promise<Response>
}

const URL_PATTERN_TO_FETCH: [RegExp, Fetcher][] = [
    [/^https:\/\/64\.media\.tumblr\.com\//, (url, referrer) => fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'image/*'
        }
    })],
    [/https:\/\/i\.pximg\.net\//, (url, referrer) => fetch('http://localhost:5000/proxy-to-pixiv', {
        method: 'POST',
        headers: {
            Accept: 'image/*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            url: url,
            referrer: referrer
        })
    })],
    [/https:\/\/pbs\.twimg\.com\//, (url, referrer) => fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'image/*'
        }
    })]
];

export async function fetchImages(imageUrls: string[], referrer: string): Promise<PostImage[]> {
    const impl = async () => {
        const imageResponses = await (() => {
            const imageResponsePromises = [];
            for (const imageUrl of imageUrls) {
                const imageResponsePromise = (() => {
                    for (const [urlPattern, fetchImpl] of URL_PATTERN_TO_FETCH) {
                        if (urlPattern.test(imageUrl)) {
                            return fetchImpl(imageUrl, referrer);
                        }
                    }
                    return null;
                })();
                if (imageResponsePromise === null) {
                    throw new Error(`${imageUrl}: An unsupported URL.`);
                }
                imageResponsePromises.push(imageResponsePromise);
            }
            return Promise.all(imageResponsePromises);
        })();

        const mimeList = [];
        const blobList = await (() => {
            const blobPromises: Promise<Blob>[] = [];
            for (const response of imageResponses) {
                if (response.ok !== true) {
                    throw new Error(`${response.url}: Failed to fetch (${response.status}).`);
                }
                const mime = response.headers.get('Content-Type');
                mimeList.push(mime);
                const blobPromise = response.blob();
                blobPromises.push(blobPromise);
            }
            return Promise.all(blobPromises);
        })();

        const base64StringList = await (() => {
            function blobToBase64(blob: Blob) {
                return new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.addEventListener('load', () => {
                        const base64String = (reader.result as string).replace(/^[^,]+,/, '');
                        resolve(base64String);
                    });
                    reader.addEventListener('error', () => {
                        reject(new Error('Failed to encode a blob into the base64-encoded string.'));
                    });
                    reader.readAsDataURL(blob);
                });
            }

            const base64StringPromises = [];
            for (const blob of blobList) {
                const base64StringPromise = blobToBase64(blob);
                base64StringPromises.push(base64StringPromise);
            }
            return Promise.all(base64StringPromises);
        })();

        const images: PostImage[] = [];
        for (let i = 0; i < imageUrls.length; ++i) {
            images.push({
                imageUrl: imageUrls[i],
                mime: mimeList[i],
                blob: base64StringList[i]
            });
        }
        return images;
    }

    let lastError: unknown = null;
    for (let i = 0; i < 5; ++i) {
        try {
            return await impl();
        } catch (e) {
            console.warn(e);
            lastError = e;
        }
    }
    throw lastError;
}
