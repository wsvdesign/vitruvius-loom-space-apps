# Vitruvius Loom

**Abandoned, but not forgotten.** An interactive 3D story about the machines NASA left on the Moon and Mars, built for the NASA Space Apps Challenge 2026: *Abandoned but not Forgotten: Storytelling about NASA's Discarded Equipment on the Moon and Mars.*

Written and designed by Natalie Walker. Independent student project; not made, reviewed or endorsed by NASA.

## The experience

Made for curious 10–13-year-olds. It feels like looking through smart glasses: a real sky, real terrain, and a thin layer of information floating in front.

1. **The telescope.** You look at tonight's real sky. Manny (Emanuel), a present-day Lakota boy drawn by the author, stands beside the telescope and talks with you. Click the Moon or Mars and the telescope swings to it, magnifies, and keeps going.
2. **The flight.** The zoom continues onto real NASA terrain and flies down to the landing site: Tranquility Base (Apollo 11) on the Moon, or Jezero Crater (Perseverance and Ingenuity) on Mars.
3. **Tranquility Base.** Manny walks on his own to the machines people left: the descent stage of the Lunar Module *Eagle*, the Laser Ranging Retroreflector (still returning data today) and the Passive Seismic Experiment. Ginny, a fictional guide shown with NASA's Ingenuity model, answers questions in the correct technical language, and each answer links to its source.
4. **Listen.** Play the real Apollo 12 seismometer recording of the lunar module *Intrepid* striking the Moon on 20 November 1969, sped up so ears can hear it, while the instrument in the scene shakes with the data.
5. **Ask anything.** Type a question; Ginny answers only from 73 checked NASA and Smithsonian facts, or says she doesn't know.

## Real data

| What | Source |
|---|---|
| Moon, Mars and Sun positions, sizes and phase for tonight | NASA JPL Horizons (`scripts/fetch-nasa-data.mjs`) |
| 9,096 stars | Yale Bright Star Catalogue, 5th revised ed., via NASA HEASARC |
| Moon and Mars terrain | Cesium Moon (NASA, USGS Astrogeology) and Cesium Mars (NASA, ESA, USGS Astrogeology), via Cesium ion |
| Moonquake | Apollo 12 Passive Seismic Experiment, network XA station S12, via EarthScope (`scripts/fetch-seismic.mjs`) |
| Spacecraft models | Apollo Lunar Module (NASA/Michael D. Carbajal), Ingenuity Mars Helicopter (NASA/Brian E. Kumanchik), NASA 3D Resources |
| Facts behind every answer | `server/facts/nasa-facts.json`, each with its NASA or Smithsonian page |

Research notes: [docs/research/nasa-resources.md](docs/research/nasa-resources.md) and [docs/research/forgotten-machines.md](docs/research/forgotten-machines.md).

## Honest labels

- The close-up ground at Tranquility Base is an illustration; the terrain seen from orbit is real.
- Only Eagle's descent stage is shown, because the ascent stage lifted off on 21 July 1969.
- The dust spray is a simulation of a landing blast using physics from NASA studies (the Moon has no wind).
- Laser pulses are shown slowed down; the real round trip takes about 2.5 seconds.
- Ginny is fictional. Ingenuity itself flew on Mars.
- Manny's Lakota lines are drafts in review with a Lakota reader. One switch in `src/content/manny.json` (`showLinesInReview`) removes them.

## Children's privacy

No accounts and no personal information. Typed questions are sent to Google Gemini on Vertex AI to be answered from the facts; questions containing an email, phone number, street address or a name ("my name is…") are refused before anything is sent, and the server logs no question text.

## Tech

React 19, TypeScript, Vite 6, React Three Fiber, drei, three.js, zustand; 3D Tiles Renderer (NASA-AMMOS) for Cesium tiles; a small Node 24 server (`server/`) for the Cesium tile pass, Gemini answers through Vertex AI, and Ginny's voice (Kokoro, open source, Apache-2.0); Manny's 3D figure built with Meshy from the author's drawings.

## Run locally

```bash
npm ci
cp .env.example .env      # add your Cesium ion token and Google Cloud project
gcloud auth login --update-adc   # Gemini through Vertex AI uses your Google sign-in, no API key
npm run api               # backend on :8787
npm run dev               # site on :5173 (proxies /api to the backend)
```

Production: `docker build .` builds the site and runs one server for the site and `/api` (`SERVE_STATIC=1`), suitable for Google Cloud Run.

## Docs

- [docs/design.md](docs/design.md): how it looks, moves and responds

## License

Code: MIT (see [LICENSE](LICENSE)). Manny's drawings and character are the author's and are not covered by the code license. NASA imagery and models follow the NASA Images and Media Usage Guidelines. Cesium terrain is used under Cesium ion's terms.
