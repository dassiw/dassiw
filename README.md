# YouTube Dual Subtitles + Flashcards (English / Korean)

Two subtitle lines on the YouTube player (Korean on top, English below). Click any word to pause the video, see its translation and an example sentence, and save it to a flashcard folder. Study the cards on a separate review page.

## Install (unpacked)
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Remove the older version of this extension, then click **Load unpacked** and select this folder.
3. Open a YouTube video with subtitles, click the extension icon and tick **Show dual subtitles**.

## Click a word
- The video pauses and a card shows the word, romanization (Korean), translation, other meanings, the sentence it appeared in (both languages) and extra examples.
- Pick a folder (or **New folder...**) and press **Add to flashcards**.
- Close with the X or **Esc**; the video resumes if it was playing before you clicked. Pressing play also closes the card.
- Korean words are translated to English, other words to Korean.

## Dictionary meanings (한국어기초사전)
Clicking a Korean word also shows the dictionary entry from the National Institute of Korean Language's learner dictionary: part of speech, vocabulary level (어휘등급: 초급/중급/고급) and numbered meanings with English glosses, plus a link to the full entry. The meanings are saved with the flashcard and shown on the review page.
1. Get a free key at https://krdict.korean.go.kr/openApi/openApiRegister (needs a login).
2. Open the extension popup, expand **Dictionary key**, paste the key and press **Save & test**. The test tells you whether the dictionary accepted it.
- Subtitles use conjugated words, so the extension also tries the basic form (학교에서 → 학교, 가요 → 가다, 했어요 → 하다). Fully irregular verbs (예뻐요 → 예쁘다) are not recognised; the card says no entry was found and you can still save the word.
- Without a key the card shows a hint and everything else works as before.
- The key is stored unencrypted in this browser (`chrome.storage.local`) and only sent to krdict.korean.go.kr.

## Flashcard review page
Open it from the popup (**Review flashcards**). Pick a folder or "All folders", press **Space** to show the answer, then rate:

| Key | Button | Comes back |
|---|---|---|
| 1 | Repeat | in 45 seconds |
| 2 | Hard | in 3 minutes |
| 3 | Normal | in 10 minutes |
| 4 | Good | 1 day (Good pressed 1-4 times), 1 week (5-10 times), 1 month (11 or more) |

The Good counter is per word and is not reset by the other buttons. The next card appears automatically when its time comes. The **Manage** tab creates, renames and deletes folders (deleting a folder moves its cards to Default) and lets you search, move and delete cards.

## Privacy and limits
- Words and sentences you click, and (only when a video lacks one of the two languages) its subtitle lines, are sent to Google Translate's public web endpoint (no API key). It is unofficial and may be rate-limited or change.
- Cards are stored only in this browser (`chrome.storage.local`); nothing is synced.
- Auto-translated subtitle lines are machine quality.
- Works on `youtube.com/watch` pages (not Shorts or embeds).
- If tracks stop loading after a YouTube change, `bridge.js` is the file to adjust.
- YouTube now returns empty subtitle files unless the request carries the player's own access token. The extension borrows that token from the player (`bridge.js`). To get it, it may briefly switch captions on and off in the player the first time you use a video; your previous caption setting is restored. After updating the extension, reload any open YouTube tabs.
- Dual subtitles need two languages. Order of preference for each line: a real YouTube track, then YouTube's own auto-translation, then **the extension translates the other line itself** (popup shows "machine-translated from English"). Translation starts at the part of the video you are watching and fills in the rest, so lines may appear a few seconds late at first. If the translation service refuses requests, that line shows as unavailable and, if both lines fail, YouTube's own captions come back.

## Tests
Automated tests run in a simulated browser (jsdom), so Chrome is not needed:

```
cd tests
npm install
npm test
```

They cover the flashcard timings (1/2/3/4 and the Good ladder), the review page keys, the word card with dictionary meanings, saving to folders, the popup key box, the subtitle token fix, per-language fallbacks and machine translation. YouTube, Google Translate and the dictionary are replaced by fakes, and the dictionary samples in `tests/fixtures.js` follow the documented fields but are not real captures, so a real key still needs the popup's **Save & test** once.
