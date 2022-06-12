const URL_PATTERN_TO_FETCH = [
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

export async function sleep(milliseconds) {
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

export function fetchImages(imageUrls, referrer) {
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
            const blobPromises = [];
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
            function blobToBase64(blob) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.addEventListener('load', () => {
                        const base64String = reader.result.replace(/^[^,]+,/, '');
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

        const images = [];
        for (let i = 0; i < imageUrls.length; ++i) {
            images.push({
                url: imageUrls[i],
                mime: mimeList[i],
                blob: base64StringList[i]
            });
        }
        return images;
    }

    let images = null;
    let error = null;
    for (let i = 0; i < 5; ++i) {
        try {
            images = impl();
            error = null;
            break;
        } catch (e) {
            console.warn(e);
            error = e;
            continue;
        }
    }
    if (images === null) {
        throw error;
    }

    return images;
}
