import { fetchImages } from '../common'
import { executeScript, createTab } from '../background/common'

async function expandPixivArtworks(tabId) {
    await executeScript({
        target: {
            tabId: tabId
        },
        func: () => {
            function expandImpl(element) {
                checkAndClick: {
                    if (typeof element.nodeName !== 'string') {
                        break checkAndClick;
                    }
                    const name = element.nodeName.toUpperCase();
                    if (name !== 'DIV') {
                        break checkAndClick;
                    }

                    const innerText = element.innerText;
                    if (innerText.search(/^\d+\/\d+$/) === -1) {
                        break checkAndClick;
                    }

                    const onclick = element.onclick;
                    if (onclick === null) {
                        break checkAndClick;
                    }

                    element.click();
                    return;
                }

                const children = element.children;
                if (typeof children !== 'object') {
                    return;
                }
                for (const child of children) {
                    expandImpl(child);
                }
            }

            expandImpl(document);
        },
        world: 'MAIN'
    });
}

async function getPixivArtistUrl(tabId) {
    const artistUrl = await executeScript({
        target: {
            tabId: tabId
        },
        func: () => {
            function impl(element) {
                checkElement: {
                    if (typeof element.nodeName !== 'string') {
                        break checkElement;
                    }
                    const name = element.nodeName.toUpperCase();
                    if (name !== 'A') {
                        break checkElement;
                    }

                    const innerText = element.innerText;
                    if (innerText !== '作品一覧を見る') {
                        break checkElement;
                    }

                    const href = element.href;
                    const pattern = /^(https:\/\/www\.pixiv\.net\/users\/\d+)\/artworks$/;
                    const match = pattern.exec(href);
                    if (Array.isArray(match) !== true) {
                        break checkElement;
                    }
                    if (/^https:\/\/www\.pixiv\.net\/users\/\d+$/.test(match[1]) !== true) {
                        throw new Error(`${match[1]}: An unexpected artist URL.`);
                    }

                    return match[1];
                }

                const children = element.children;
                if (typeof children !== 'object') {
                    return null;
                }
                for (const child of children) {
                    const result = impl(child);
                    if (typeof result === 'string') {
                        return result;
                    }
                }
                return null;
            }

            return impl(document);
        },
        world: 'MAIN'
    });
    return artistUrl;
}

async function getPixivImagesImpl(tabId, sourceUrl, images) {
    const newTab = await createTab({
        openerTabId: tabId,
        url: sourceUrl,
        active: false
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

    const artistUrl = await getPixivArtistUrl(newTab.id);
    if (typeof artistUrl !== 'string') {
        console.warn(`${sourceUrl}: Failed to get artist URL.`);
        chrome.tabs.remove(newTab.id);
        return;
    }

    await expandPixivArtworks(newTab.id);

    const linkUrls = await executeScript({
        target: {
            tabId: newTab.id
        },
        func: () => {
            const links = [];
            for (let i = 0; i < document.links.length; ++i) {
                const link = document.links[i];
                const href = link.href;
                links.push(href);
            }
            return links;
        },
        world: 'MAIN'
    });

    const imageUrlPattern = /^https:\/\/i\.pximg\.net\/img-original\/img\/\d{4}(?:\/\d{2}){5}\/\d+_p0\.\w+/;
    const imageUrls = [];
    for (const imageUrl of linkUrls) {
        if (imageUrl.search(imageUrlPattern) === -1) {
            continue;
        }
        imageUrls.push(imageUrl);
    }

    const imageUrlsUniqued = [...new Set(imageUrls)];
    const newImages = await fetchImages(imageUrlsUniqued, sourceUrl);
    for (const newImage of newImages) {
        newImage.artistUrl = artistUrl;
        images.push(newImage);
    }

    chrome.tabs.remove(newTab.id);
}

export async function getImages(tabId, hrefs, innerText) {
    const sourceUrls = [];
    {
        const sourceUrlPattern = /^https:\/\/href\.li\/\?https:\/\/(?:www\.)?pixiv\.net(?:\/en)?(\/artworks\/\d+)/;
        for (const href of hrefs) {
            const matches = sourceUrlPattern.exec(href);
            if (!Array.isArray(matches)) {
                continue;
            }
            sourceUrls.push('https://www.pixiv.net' + matches[1]);
        }
    }
    {
        const sourceUrlPattern = /^https:\/\/href\.li\/\?http:\/\/www\.pixiv\.net\/member_illust\.php\?mode=[^&]+&illust_id=(\d+)/;
        for (const href of hrefs) {
            const matches = sourceUrlPattern.exec(href);
            if (!Array.isArray(matches)) {
                continue;
            }
            sourceUrls.push('https://www.pixiv.net/artworks/' + matches[1]);
        }
    }

    const images = [];
    for (const sourceUrl of [...new Set(sourceUrls)]) {
        await getPixivImagesImpl(tabId, sourceUrl, images);
    }
    return images;
}
