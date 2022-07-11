## nonalt-reblog

### Building

```
npm install
npm run build  # for one-time build
npm run watch  # for continuous build
```

An unpacked Chrome extension is written to `dist/`.

### What is this Chrome extension for?

This Chrome extension uses your Tumblr account to efficiently curate your favorite illustrations. The illustrations targeted by this extension are limited to Japanese anime-style illustrations (also known as "萌え絵" or "2次元画像" in Japanese). Other types of images are completely outside the scope of this extension.

Tumblr has a small but active cluster of accounts. A few of them cite many Japanese anime-style illustrations mainly from Twitter and pixiv to Tumblr. The others actively reblog these posts. This Chrome extension uses the activity of this Tumblr account cluster to curate Japanese anime-style illustrations.

### Prerequisites

To use this Chrome extension, you will need the latest stable version of Google Chrome, a Tumblr account, and a Twitter account. In addition, this extension is designed to run for long periods of time and consume large amounts of memory. In particular, a memory footprint comparable to that of a high-end PC (32 GB or more) is recommended.

Please remember that this extension depends on the existence of the following people, and you should therefore always be grateful to them when using this extension. First, needless to say, the illustrators who create the illustrations, second, the few Tumblr accounts who cite these illustrations to Tumblr from the sites where they were originally posted, and third, the other accounts who actively reblog and spread these illustrations in Tumblr.

### Challenges this Chrome extension solves

Consider that you want to fill your Tumblr account with cute ("可愛い (KAWAII)") Japanese anime-style illustrations. The first thing you need to do is to follow accounts on Tumblr that cite a lot of your favorite illustrations from outside Tumblr, or that reblog a lot of your favorite illustraions.

However, following one or two such Tumblr accounts is not enough at all. Hundreds or thousands of Japanese anime-style illustrations are being generated around the world from Twitter, pixiv, and other social networking sites every day. The coverage of the few Tumblr accounts would be negligible in relation to that population of illustrations.

What you should do next is to follow as many accounts as possible that post and/or reblog your favorite illustrations to ensure that as many ones of your favorite as possible flow into your Tumblr dashboard. This can be done by selecting one of the illustrations that you like and finding accounts that post or reblog it and that you are not yet following. If the account's posting and/or reblogging trends match your preferences, then follow that account. This will bring up multiple new illustrations that you might like into your dashboards. By repeating the above process, you will be able to follow accounts that match your preferences one after another. Once you have a certain number of accounts that you follow, you can also use Tumblr's analysis of the following network to review the accounts that it recommends to you, though the quality of the recommendation can vary widely.

Now, you probably already follow hundreds of Tumblr accounts by following the above steps. Your dashboard should be filled with your favorite illustrations. But at the same time, you are facing some major problems.

- The number of posts flowing into your dashboard per day should already be in the thousands. This is not a number that can be viewed in between your daily life, work, and sleep.

- Some images will be repeatedly posted and/or reblogged by several of the accounts you follow. This means that the same image will appear on your dashboard more than once. It is inevitable that popular images are posted and/or reblogged multiple times, but in general, you do not want this kind of duplication.

- An account that cites or reblogs many illustrations that match your preferences may not always post or reblog posts that match your preferences. The account may post and reblog text posts, or post and reblog images other than Japanese anime-style. These posts are of no interest to you and you may want to remove them from your dashboard.

- Tumblr's dashboard has nice shortcut key features where you can press the `J` key to scroll and focus to the next post, and the `K` key to scroll and focus to the previous post. Unfortunately, these features quickly becomes unresponsive to key presses when the number of posts displayed on the dashboard exceeds several hundreds.

- In the Tumblr dashboard, pressing the `R` key while holding down the `Alt` key will reblog the focused post. In particular, by combining the above-mentioned `J`/`K` key with the `Alt`+`R` key, you can quickly and massively reblog posts on the dashboard. This is called "high-speed reblogging" in some circles. However, reblogging with the `Alt`+`R` key is accompanied by UI effect, and shortcut key operations are not accepted during this effect. As you become more proficient at high-speed reblogging, this delay will cause unbearable stress.

- In reblogging an illustration, we should not forget to show respect to the illustrator who created it. As a minimum courtesy, the correct source of the illustration must be stated in the post. Or, if we are talking about the law, at least in Japan, the correct source must be stated in order to legally cite the original work. However, not every post on Tumblr has the correct source.

This Chrome extension aims to solve the above problems with as little human intervention as possible.

### How to use this Chrome extension

1. Run `pip install -r requirements.txt` with the `api` directory as the current directory. This will install prerequisite Python packages to run the API server.
2. Run `flask run` with the `api` directory as the current directory. This will start the HTTP server and it will start listening to 5000/TCP on localhost.
3. Log in to Tumblr and Twitter with Google Chrome.
4. Open `https://www.tumblr.com/dashboard`. Enable infinite scrolling on the dashboard in the Tumblr settings. Since this project is in active development stage, it is strongly recommended to open the Developer Tools for the page to display the console and display the service worker console for this extension. Press the `J` key to focus on the first post on the dashboard, then press the `P` key. This will start the process of scrolling endlessly through the dashboard to retrieve information about the posts on the dashboard. This process continues until the `P` key is pressed again on the dashboard or one hour has elapsed.
5. Stopping the above process will stop the scrolling on the dashboard, but another background process will continue. This can be confirmed by repeated opening and closing of Twitter and pixiv pages in another tab. Alternatively, the activity of this process can also be seen in the console on the dashboard page.
6. After the above actions have completely stopped, open `chrome-extension://${extensionId}/index.html`. At first, only the URLs of the posts extracted from the dashboard are listed on this page, but once all the URLs are listed, the illustrations of each post is displayed.
7. Now that you've made it this far, let the high-speed reblogging begin. Press `J` key to scroll to the next post, `K` key to scroll to the previous post, and `R` key (no need to press `Alt` key) to reblog the focused post. When you have finished reblogging the required posts on this page, click the `Complete` button at the bottom of the page. Note that the list of posts displayed on this page is composed of dashboard posts that meet the following criteria:
    - Even if the same image appears multiple times on the dashboard, it will appear only once on this page.
    - Only posts where the source of the illustrations can be identified as a Twitter or pixiv URL are displayed.
8. In the above step I explained that you can reblog a post with the `R` key, but in fact the post is not yet reblogged. To reflect the reblog, press the `Q` key on the dashboard. This will allow you to observe the automatic reblogging process.

An important aspect of the above procedure is that manual labor is limited to a minimum with maximum efficiency. In summary, all you need to do is

1. press the `P` key on your Tumblr dashboard,
2. do high-speed reblogging with keyboard shortcuts on the minimized pseudo-dashboard, and
3. press the `Q` key on the Tumblr dashboard.

I hope that you will be able to enjoy a fulfilling Tumblr life by repeating the above steps.
