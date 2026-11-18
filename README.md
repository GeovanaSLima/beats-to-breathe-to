# beats to breathe to

A lo-fi radio that plays at your heart rate.

> This is a musical instrument, not a health tool.

## Privacy and data handling

- **Consent:** the camera turns on only after you tick a checkbox and press a button. You can turn it off at any time from every screen, and it turns off automatically on the final screen.
- **Images stay on your computer:** the camera is read by the Presage SmartSpectra SDK running locally inside the bridge. No camera image, video or audio is recorded, stored or sent anywhere.
- **What is sent to Presage:** the SDK turns the camera feed into numbers (pulse, breathing rate, HRV). Those numbers, never images, go to Presage, the company that makes the SDK, in two cases:
  - **API key check:** the SDK contacts Presage to validate the API key and subscription when a session starts.
  - **Automatic AI summaries:** the SDK also sends the measured numbers to Presage on its own, about every 60 seconds while the camera is on. Presage passes them to an AI model to generate a short summary ("LLM Insights"). This is built into the SDK and can't be turned off. This app never asks for, shows or stores those summaries. Presage's documentation does not say how long it keeps this data. See [Presage's LLM Insights docs](https://smartspectra.presagetech.com/docs/llm-insights).
- **SDK telemetry is off:** the bridge sets `enableTelemetry: false`, so the SDK sends no usage or diagnostic reports. See [Presage's telemetry docs](https://smartspectra.presagetech.com/docs/telemetry-and-privacy).
- **Inside the app:** the numbers travel from the bridge to the browser over `localhost` only. They live in memory during the session and are discarded on stop or close. No accounts, no database, no cookies, no localStorage, no analytics.
- **Your clip:** the 15 s clip is drawn from the music and the on-screen visuals (no camera image). It is made in memory and saved only if you click Download.
- **Deletion:** closing the tab or pressing "Turn off" stops the camera and clears everything the app holds.
- **Not a health tool:** no diagnosis, no medical claims. Pulse and breathing are musical inputs only.
