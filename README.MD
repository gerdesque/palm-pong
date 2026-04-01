# Palm-Pong

![Palm-Pong preview](assets/siteOGImage3.png)

Palm Brick Breaker is an offline-first browser game where you control the paddle with your hand and webcam.
This fork is highly inspired by the original camera-controlled brick-breaker concept, but it has been reworked
to remove hosted services, install dependencies locally through `npm`, and run fully offline after setup.

## Highlights

- Local `npm` dependency management instead of CDN script tags
- Fully offline gameplay after `npm install`
- Local leaderboard stored in browser `localStorage`
- Warm-up area to test hand tracking before starting
- Cleaner HTML, CSS, and JavaScript structure for easier maintenance

## Run locally

```bash
npm install
npm start
```

Then open the local server URL in a browser and allow camera access.

## Project scripts

- `npm start` runs a local static server
- `npm run prepare-assets` copies MediaPipe runtime files into `vendor/mediapipe`

## Privacy

Camera frames stay on the device. This project does not submit scores or webcam data anywhere.

## License

The original project was MIT-licensed, and this fork keeps that license in place.
