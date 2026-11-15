# NASA data and resources for Vitruvius Loom

Written by Natalie Walker

Checked on 2026-11-14. Every page below was read on that date with an automated web reader unless the row says otherwise. Labels:

- **Verified**: the named page says it.
- **From brief**: stated in the project's own planning notes, not checked against the original page.
- **Interpretation**: reasoning, with what would confirm it.

The fact list the app's "ask" endpoint uses is `server/facts/nasa-facts.json` (70 facts, all **Verified**). The table of hardware left on the Moon and Mars is in `docs/research/forgotten-machines.md`.

---

## 1. Space Apps challenge page

| Item | Result |
|---|---|
| Page | https://www.spaceappschallenge.org/2026/challenges/abandoned-but-not-forgotten-storytelling-about-nasas-discarded-equipment-on-the-moon-and-mars/ |
| Also tried | the same URL with `?tab=resources`, and the bare `spaceappschallenge.org` host |
| Outcome | **Not read.** All three requests failed with a TLS certificate error ("unable to get local issuer certificate"). This is a block on the automated reader, not a missing page. A web search did not find any copy of the challenge text. |
| Listed data sets, tools, links | **Unknown.** Nothing is recorded here, so none of it should be treated as known. |
| Is any resource required? | **Unknown.** |
| Needed | Someone should open the page in a browser and paste the Overview, Objectives, Considerations and Resources tab text. Then this section can be filled in and each listed resource added to the table in section 2. |

---

## 2. Data sources: used now and recommended

| Source | Used for | Where in repo | Credit line to show | Terms and limits | Status |
|---|---|---|---|---|---|
| **NASA JPL Horizons API** v1.3 (June 2025), `https://ssd.jpl.nasa.gov/api/horizons.api` | Moon, Mars and Sun positions, illuminated fraction, apparent size and distance for the telescope sky | `scripts/fetch-nasa-data.mjs` → `public/data/ephemeris.json`; read by `src/sky.ts` | "Ephemerides: NASA JPL Solar System Dynamics Group, Horizons On-Line Ephemeris System" (taken from the Horizons output footer) | The docs page does not mention an API key or rate limits. Input errors still return HTTP 200, so the payload must be checked. HTTP 503 means overload or maintenance. **Limit (Interpretation):** the file uses observer `500@399`, which is Earth's centre. For a real backyard, the Moon's position can differ by up to about 1° because of parallax. That is fine for a storytelling view but should not be called an exact local position. | Verified (docs page and file provenance). Retrieved 2026-11-14T19:28:46Z; covers 2026-11-13 to 2026-11-23 in 1-hour steps. |
| **NASA HEASARC BSC5P**, Yale Bright Star Catalogue, 5th ed. (preliminary) | Background stars down to magnitude 6.5 | `public/data/stars.json`; `src/sky.ts` | "Yale Bright Star Catalogue, 5th ed. (Hoffleit & Warren 1991), via NASA HEASARC" | HEASARC says it does **not** own the copyright and provides the catalogue for scientific research. Yale University Observatory and/or the authors may hold rights. Positions are given for J2000. The page was updated 10-Nov-2026. | Verified |
| **Cesium ion asset 2684829**, Moon terrain | Fly-down to Tranquility Base | backend tile pass (token stays server-side) | "NASA and the USGS Astrogeology Science Center" | Attribution comes from the brief. The Cesium ion asset page needs a login and was not read. Check the asset's own license text in Cesium ion before deploying. | From brief |
| **Cesium ion asset 3644333**, Mars terrain | Fly-down to Jezero Crater | backend tile pass | "NASA, ESA, and the USGS Astrogeology Science Center" | From the brief. **Interpretation:** ESA-sourced data may carry ESA terms on top of NASA's. Check the asset's license in Cesium ion. | From brief |
| **NASA Science pages** (science.nasa.gov): Moon Facts, Weather on the Moon, Water & Ices, Moonquakes, Mars Facts, mission pages | Ginny's answers, through `nasa-facts.json` | `server/facts/nasa-facts.json` | "NASA" | See section 3 | Verified |
| **NASA NSSDCA** (nssdc.gsfc.nasa.gov): Apollo 11, Apollo 12, Apollo 13 S-IVB, LRV, Mars Fact Sheet | Apollo dates, coordinates, hardware left behind, Mars gravity | `nasa-facts.json` | "NASA Space Science Data Coordinated Archive" | Some records are decades old. Coordinates differ slightly between records (section 7). | Verified |
| **ILRS / NASA Goddard**: Apollo 11 retroreflector | Retroreflector still in use | `nasa-facts.json` | "NASA Goddard / ILRS" | The page's "last modified" date (2012) conflicts with its own 2023 references. | Verified |
| **NASA JPL news and Photojournal** (jpl.nasa.gov) | Ingenuity, Phoenix, InSight, the 2018 dust storm, ice images | `nasa-facts.json`; section 4 | Use each image's own credit line exactly (section 4) | Many JPL credits name non-NASA partners (MSSS, Univ. of Arizona, ASU, LANL/CNES/CNRS, PSI, USGS). See section 3. | Verified |
| **NASA NTRS** (ntrs.nasa.gov): lander plume dust papers | Dust speeds and Surveyor 3 findings | `nasa-facts.json` | Cite authors and NTRS ID | These are conference papers and models, not mission records. | Verified (abstracts only) |
| **Smithsonian NASM** (airandspace.si.edu, becomingvisible.si.edu) | Apollo A7L suit, ILC seamstresses | `nasa-facts.json` | "Smithsonian National Air and Space Museum" | Not NASA. Smithsonian images have their own terms. Cite the text and do not copy images without checking si.edu terms. `womenshistory.si.edu` returned HTTP 403 and was not read. | Verified |
| **MIT News**: BioSuit (2014) | Mechanical counter-pressure suit idea | `nasa-facts.json` | "MIT News" | Not NASA. The suit is a research prototype, not a flight suit. | Verified |
| *Recommended:* Apollo Passive Seismic Experiment data | Real moonquake recording and sound | (moonquake workstream) | to be set from the archive record | **Not checked here.** Candidate archives are the NASA PDS Geosciences Node and NSSDCA. The exact station, date and data product need confirming. | Gap |
| *Recommended:* NASA's 2011 lunar historic-sites guidance, "Recommendations to Space-Faring Entities: How to Protect and Preserve the Historic and Scientific Value of U.S. Government Lunar Artifacts": https://www.nasa.gov/wp-content/uploads/2017/10/617743main_nasa-usg_lunar_historic_sites_reva-508.pdf | Directly on the challenge theme: what was left at Apollo sites and why it is protected | — | "NASA" | **Not read.** The PDF downloaded but could not be converted to text in this session. The title and date are from memory and must be confirmed. | Gap |
| *Recommended:* LRO images of Tranquility Base | Showing the real descent stage from orbit | — | — | Not searched this session. | Gap |

---

## 3. Credit and usage rules (NASA Images and Media Usage Guidelines)

Source: https://www.nasa.gov/nasa-brand-center/images-and-media/ (page last updated Oct 27, 2026). **Verified** quotes:

- NASA material "generally are not subject to copyright in the United States", and educational or informational use is allowed.
- "NASA should be acknowledged as the source of the material."
- "The use of the Insignia, Logotype and NASA identifiers is protected by law." This covers the meatball, the worm and the seal. **Do not show any NASA logo in the app, video or submission.**
- "NASA will not promote or endorse or appear to promote or endorse a commercial product, service or activity." The app must not suggest NASA made, reviewed or endorses it.
- On generated imagery, the reader reported: NASA "does not permit our Insignia" to appear with "SI"-generated imagery. **Check this wording on the live page.** It matters because the Manny model and some scenes are generated, so no NASA insignia should appear on or near them.
- Images of identifiable people: "permission should be obtained from the person" for commercial use. Current NASA astronauts and employees "cannot have their names, likenesses or other personality traits displayed" in a way that implies endorsement.
- Third-party material: "Those wishing to use copyright protected material of third parties must contact the copyright holder directly," and "NASA's use does not convey any rights to others to use the same material."

**Interpretation for the app:**
1. Copy each image's credit line exactly as published.
2. Where a credit names a partner (for example "NASA/JPL-Caltech/MSSS" or "NASA/JPL-Caltech/Univ. of Arizona"), treat the image as NASA-released. For a non-commercial hackathon entry, keep the full credit and do not crop it out.
3. Add a line to the credits drawer: "Vitruvius Loom is an independent student project. It is not made, reviewed or endorsed by NASA."
4. Keep fictional characters clearly labelled as fiction. Ginny is inspired by Ingenuity, and Ingenuity never went to the Moon.

---

## 4. Imagery

Captions are verbatim where shown in quotes. Where the reader only returned part of a caption, that is noted, and the full caption should be copied from the page before it is shown on screen.

### 4a. Mars dust storms and dust devils

| Image | Page | Full-res image | Caption | Credit | Date |
|---|---|---|---|---|---|
| PIA22487 "Mars Before and After Dust Storm" (MRO MARCI, the 2018 global storm) | https://www.jpl.nasa.gov/images/pia22487-mars-before-and-after-dust-storm/ | JPG https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA22487.jpg · TIFF https://photojournal.jpl.nasa.gov/tiff/PIA22487.tif · GIF https://photojournal.jpl.nasa.gov/archive/PIA22487.gif | First sentence: "This image shows how dust has enveloped the Red Planet." (Full caption on page.) | NASA/JPL-Caltech/MSSS | Jul 19, 2018 |
| PIA15116 "The Serpent Dust Devil of Mars" (HiRISE) | https://www.jpl.nasa.gov/images/pia15116-the-serpent-dust-devil-of-mars/ | JPG https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA15116.jpg · TIFF https://photojournal.jpl.nasa.gov/tiff/PIA15116.tif | Opens: "A towering dust devil casts a serpentine shadow over the Martian surface" (partial). The plume is more than half a mile (800 m) tall and about 30 m across. | NASA/JPL-Caltech/Univ. of Arizona | Published Mar 7, 2012 (observed Feb 16, 2012) |
| PIA22329 "Dust Storm Covers Opportunity" (MARCI global map, June 6, 2018) | https://www.jpl.nasa.gov/images/pia22329-dust-storm-covers-opportunity/ | not captured | not captured | not captured | Found in search only; **not opened** |

### 4b. Dust on Mars hardware

| Image | Page | Full-res image | Caption | Credit | Date |
|---|---|---|---|---|---|
| PIA25287 "InSight's Final Selfie" | https://www.jpl.nasa.gov/images/pia25287-insights-final-selfie/ | JPG https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA25287.jpg · TIFF https://photojournal.jpl.nasa.gov/tiff/PIA25287.tif | "NASA's InSight lander took this final selfie on April 24, 2022." Next sentence opens: "The lander is covered with far more dust than it was in its first selfie, taken in December 2018" (partial). | NASA/JPL-Caltech | Taken Apr 24, 2022; page May 23, 2022 |
| "Dusty Mars Rover Selfie" (Opportunity, PIA15115) | in the article https://science.nasa.gov/missions/mer/nasas-opportunity-rover-mission-on-mars-comes-to-end/ | https://assets.science.nasa.gov/content/dam/science/psd/mars/resources/detail_files/3/3811_PIA15115_sols2811-14_L456atc-full2.jpg | Title only captured | NASA/JPL-Caltech/Cornell/Arizona State Univ. | Article Feb 13, 2019 |
| "Opportunity Self-Portrait" (cleaner deck, for comparison) | same article | https://assets.science.nasa.gov/content/dam/science/psd/mars/resources/detail_files/5852_Sol322B_DeckPan_crop-PIA07372-full2.jpg | Title only captured | NASA/JPL-Caltech/Cornell | — |
| Apollo 17 Gene Cernan with dusty suit (Moon, for comparison) | https://science.nasa.gov/solar-system/10-things-dust-in-the-wind-on-mars-and-well-beyond/ | not captured | "Dark Moon dust clings to the spacesuit of Apollo 17 astronaut Gene Cernan following an excursion on the lunar surface." | NASA | Page Jul 26, 2022 |

Spirit's dust-devil "cleaning event" (March 2005, power rose from 60% to 93%) is **Verified as a fact** (https://science.nasa.gov/mission/mer-spirit/). A before-and-after image was **not found** this session.

### 4c. Water and ice: Moon

| Image | Page | Full-res image | Caption | Credit | Date |
|---|---|---|---|---|---|
| Moon Mineralogy Mapper (M3) polar ice map | https://www.jpl.nasa.gov/news/ice-confirmed-at-the-moons-poles/ | https://d2pn8kiwq2w21t.cloudfront.net/images/imagesmoon20180820elphic20180820-16.width-1024.jpg (1024-px web size) | "The image shows the distribution of surface ice at the Moon's south pole (left) and north pole (right), detected by NASA's Moon Mineralogy Mapper instrument. Blue represents the ice locations, plotted over an image of the lunar surface, where the gray scale corresponds to surface temperature (darker representing colder areas and lighter shades indicating warmer zones). The ice is concentrated at the darkest and coldest locations, in the shadows of craters." (assembled from verbatim segments) | NASA | Aug 20, 2018 |
| LCROSS impact site, Cabeus (LOLA terrain view) | https://science.nasa.gov/image-detail/20110615lcross/ | https://science.nasa.gov/wp-content/uploads/2024/01/20110615lcross.jpg (1000×1085) | Paraphrase only: a LOLA view of the Cabeus area showing terrain hidden in permanent shadow. LRO and LCROSS data indicate volatiles, including water, there. | not stated on page; use "NASA" | Page updated Jan 26, 2024 |

LRO/LAMP permanently-shadowed-region imagery was **not found** this session.

### 4d. Water and ice: Mars

| Image | Page | Full-res image | Caption | Credit | Date |
|---|---|---|---|---|---|
| PIA26045 "SWIM Map Shows Subsurface Water Ice on Mars" | https://www.jpl.nasa.gov/images/pia26045-swim-map-shows-subsurface-water-ice-on-mars/ | JPG https://d2pn8kiwq2w21t.cloudfront.net/original_images/PIA26045.jpg · TIFF https://photojournal.jpl.nasa.gov/tiff/PIA26045.tif | "The blue areas on this map of Mars show regions where NASA missions have detected subsurface water ice." The map is used to pick landing sites for the first astronauts (paraphrase). Covers the equator to 60°N. | NASA/JPL-Caltech/Planetary Science Institute | Oct 26, 2023 |
| PIA22077 "Underground Martian Ice Deposit Exposed at Scarp" (HiRISE) | https://www.jpl.nasa.gov/images/pia22077-underground-martian-ice-deposit-exposed-at-scarp/ | JPG https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA22077.jpg · TIFF https://photojournal.jpl.nasa.gov/tiff/PIA22077.tif | "A cross-section of a thick sheet of underground ice is exposed at the steep slope (or scarp) that appears bright blue" (opening). About 260 vertical feet (80 m) of ice is exposed. | NASA/JPL-Caltech/UA/USGS | Jan 11, 2018 |
| Phoenix "Dodo-Goldilocks" trench, ice sublimating over 4 days (animated) | https://www.jpl.nasa.gov/news/bright-chunks-at-phoenix-landers-mars-site-must-have-been-ice/ | https://d2pn8kiwq2w21t.cloudfront.net/original_images/imagesphoenixcollection_16dodo_020_024.gif | Caption notes "In the lower left corner, lumps disappear". | not shown on page; use "NASA/JPL-Caltech/University of Arizona/Texas A&M University" **only after confirming** on PIA10910/PIA10911 | Jun 19, 2008 |

Related, found in search but **not opened**: PIA10910 "Ice on Mars - Now You See It" and PIA10911 "Ice on Mars - Now It's Gone".

**Not found this session:** SHARAD radar ice maps, ice exposed under the Phoenix lander by its thrusters, and HiRISE new impact craters exposing ice.

### 4e. Forgotten machines (also in `forgotten-machines.md`)

| Image | Page | Full-res image | Caption | Credit | Date |
|---|---|---|---|---|---|
| PIA26236 "Perseverance Spots Ingenuity at Its Final Airfield" | https://www.jpl.nasa.gov/images/pia26236-perseverance-spots-ingenuity-at-its-final-airfield/ | JPG https://d2pn8kiwq2w21t.cloudfront.net/original_images/PIA26236.jpg · TIFF https://photojournal.jpl.nasa.gov/tiff/PIA26236.tif | Paraphrase: an enhanced-color Mastcam-Z mosaic of Ingenuity at "Valinor Hills", taken from about 1,475 ft (450 m) away. | NASA/JPL-Caltech/ASU/MSSS | Taken Feb 4, 2024; page Feb 7, 2024 |
| PIA25219 "Rover's Backshell Seen From the Air" | https://www.jpl.nasa.gov/images/pia25219-rovers-backshell-seen-from-the-air/ | JPG https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA25219.jpg · TIFF https://photojournal.jpl.nasa.gov/tiff/PIA25219.tif | "This image of Perseverance's backshell and parachute was collected by NASA's Ingenuity Mars Helicopter" (opening, from the news release) | NASA/JPL-Caltech | Taken Apr 19, 2022 (Flight 26) |
| PIA25217 backshell and supersonic parachute | https://www.jpl.nasa.gov/images/pia25217-rover-landing-gear-seen-from-the-air-by-mars-helicopter/ | https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA25217.jpg | "This image of Perseverance's backshell and supersonic parachute was captured by NASA's Ingenuity Mars Helicopter" (opening) | NASA/JPL-Caltech | Apr 19, 2022 |
| PIA25218 debris field | https://www.jpl.nasa.gov/images/pia25218-debris-field-for-perseverance-landing-gear-seen-from-mars-helicopter/ | https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA25218.jpg | "Perseverance's backshell, supersonic parachute, and associated debris field is seen strewn across the Martian surface" (opening) | NASA/JPL-Caltech | Apr 19, 2022 |
| Apollo 12 LM and Surveyor 3 (AS12-48-7134) | https://science.nasa.gov/resource/apollo-12-and-surveyor-3/ | https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/a/as12-48-7134.jpg (9.36 MB) | Paraphrase: taken on Apollo 12's second moonwalk. Surveyor 3 is in the foreground and the lunar module is in the background. Conrad and Bean later removed Surveyor's TV camera and other parts. | NASA | Nov 20, 1969 |

---

## 5. Check of the numbers and claims in `src/content/ginny.json`

| Where | Current text | Status | Source | Suggested text |
|---|---|---|---|---|
| `answers.temp.body` | "About +250°F in sunlight and −208°F in shadow — on the same day, a few steps apart." | **Contradicted in part.** +250°F is right for daytime near the equator. −208°F is NASA's figure for **after nightfall** near the equator, not for shadow a few steps away. NASA gives no number for nearby shadow. | https://science.nasa.gov/moon/weather-on-the-moon/ | "Near the Moon's equator, the ground can heat to over 250°F (121°C) in daylight, then drop to −208°F (−133°C) after nightfall. With hardly any air to spread the Sun's heat, sunlit and shadowed spots are extremely different." |
| `answers.temp.src` | "NASA Science · Moon temperatures" | Page title is different | same | "NASA Science · Weather on the Moon" |
| `answers.dust.body` | "Apollo crews said it smelled like spent gunpowder." | **Wording not supported.** NASA says "a distinctive, pungent odor, not unlike gunpowder". The word "spent" does not appear. | https://science.nasa.gov/solar-system/10-things-dust-in-the-wind-on-mars-and-well-beyond/ | "Apollo crews said it had a sharp smell, a bit like gunpowder." |
| `answers.dust.body` | "The dust is jagged — no wind ever wore it smooth — and it clings to everything." | **Verified in substance.** NASA ties the jagged grains to little weathering on the Moon and says the roughness makes them cling and scratch. | same | "The grains are rough and jagged, because nothing on the Moon wears them smooth, so they cling to surfaces and scratch them." |
| `answers.dust.body` | "the Moon itself has no wind" | **Verified.** The exosphere is too thin to make weather. | https://science.nasa.gov/moon/weather-on-the-moon/ | keep |
| `answers.dust.title`, `beats[1]` | "Sharp as broken glass" / "the dust is sharp as broken glass" | **Not found in any source read.** It is a figure of speech. | — | Keep only as a simile, or use "rough and jagged" (Verified). |
| `answers.dust.src` | "NASA · Apollo lunar dust reports" | Too broad | — | "NASA Science · 10 Things: Dust in the Wind" |
| `answers.water.body` | "as ice, hiding in craters near the poles where the Sun never shines" | **Verified** | https://science.nasa.gov/moon/moon-water-and-ices/ ; https://www.jpl.nasa.gov/news/ice-confirmed-at-the-moons-poles/ | keep. Add: "NASA also found a tiny bit of water stuck to dust grains in sunlit soil, about a 12-ounce bottle's worth in a cubic meter of soil, but that isn't ice." |
| `answers.water.body` | "Every pound of ice is a pound of water nobody had to carry from Earth." | **Interpretation.** Not in any source read. | — | Keep only if it is fine to state it as reasoning, or drop it. |
| `answers.water.body` | "Follow the glow to the crater rim." | Scene direction. The product requirements say not to suggest ice at the Apollo 11 site. | `docs/Vitruvius_Loom_Manny_MVP_PRD_V1.md` line 110 | Make sure the scene moves to a labelled polar location. |
| `answers.water.src` | "NASA · LCROSS & LRO findings" | Partly right. The 2018 surface-ice detection was by M3. | as above | "NASA Science · Water & Ices on the Moon; NASA JPL · Ice Confirmed at the Moon's Poles (2018)" |
| `answers.gold.body` | "Thin shiny sheets with netting between them …" | **Not verified this session.** No NTRS lunar module thermal-control document was read. | — | Find the source document before quoting. |
| `answers.gold.body`, `beats[2]` | "left it here in 1969", "left it behind in 1969" | **Verified:** the descent stage "was left behind on the Moon". | https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-059C | keep |
| `beats[1]` | "There is no air here" | **Close.** NASA says the Moon has "hardly any atmosphere" (a very thin exosphere). | https://science.nasa.gov/moon/facts/ | "There is almost no air here" |
| `quake` | "Apollo astronauts left seismometers that listened for years." | **Verified overall** (the Apollo 12 station ran Nov 19, 1969 to Sep 30, 1977), **but** the seismometer at Tranquility Base, where this scene is set, only worked for weeks. That experiment ended Aug 27, 1969. | https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-099C ; https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-059C | "Apollo astronauts left seismometers on the Moon. The one here worked for only a few weeks in 1969, but later ones listened until 1977." |
| `quake` | "The Moon does ring — quakes travel through it like a bell." | **"Like a bell" not verified.** What is verified: after Apollo 12's empty lander was crashed on purpose, strong signals lasted more than half an hour and weaker signals stopped about an hour later. | https://www.nasa.gov/missions/apollo/apollo-12-the-pinpoint-mission/ | "When astronauts crashed an empty lander into the Moon on purpose, the seismometer felt strong shaking for more than half an hour, and faint shaking for about an hour." |

---

## 6. The Moon and Mars tonight (Saturday, November 14, 2026, evening ET)

From the repo's `public/data/ephemeris.json` (JPL Horizons, Earth-centre observer, retrieved 2026-11-14T19:28:46Z). Rows used: unix 1794700800, 1794704400 and 1794708000, which are 7, 8 and 9 PM EST.

| Body | 7 PM EST | 9 PM EST | Notes |
|---|---|---|---|
| Moon, illuminated | 27.2% | 27.9% | Rising through the evening, so the Moon is a **waxing crescent**. About 25–26% earlier in the afternoon. |
| Moon, distance | 0.0027058 AU ≈ **404,800 km (≈ 251,500 mi)** | 0.0027050 AU ≈ 404,650 km | Farther than the 384,400 km average (NASA Moon Facts). km conversion uses 1 AU = 149,597,870.7 km. |
| Moon, apparent size | 1,770.6″ (about 0.49°) | 1,771.2″ | — |
| Mars, distance | 1.31585 AU ≈ **196.8 million km (≈ 122 million mi)** | 1.31514 AU ≈ 196.7 million km | **Interpretation (arithmetic):** light takes about 10.9 minutes to travel that far. |
| Mars, illuminated | 89.45% | 89.45% | Apparent size 7.1″, too small to show detail in a small telescope. |

---

## 7. Conflicts between sources

| Topic | Source A | Source B | Note |
|---|---|---|---|
| Apollo 11 landing point | NSSDCA mission summary: 0.67 N, 23.47 E | NSSDCA LM record: 0.67416 N, 23.47314 E; ILRS reflector: 0.6734 N, 23.473 E | Consistent within rounding. The reflector sits a few metres from the lander. |
| Apollo 12 distance to Surveyor 3 | NSSDCA: within about 180 m | NASA "Pinpoint Mission": about 535 ft (163 m) northwest; NASA Science: about 600 ft; JPL blog: less than 600 ft | Use "less than 600 feet (about 180 m)". |
| Surveyor 3 landing date | NSSDCA: April 20, 1967 | NASA Science image page: April 19, 1967 | Probably a time-zone difference (UT versus US time). |
| Apollo A7L layer count | NASM Armstrong page, conservation text: "12 synthetic materials with as many as 21 layers" | same page, callout: "25 layers" | Use "as many as 21" or "more than 20". |
| Viking 1 landing point | NASA Science: 22.483°N, 47.94°W | NASA GISS Mars24: 22.27°N, 312.05°E (= 47.95°W) | Longitudes agree. Latitude differs by about 0.2°, possibly a different coordinate solution. |
| Spirit landing date | NASA Science: Jan 3, 2004 | GISS: Jan 4, 2004 UTC | Time zone. |
| Opportunity landing date | NASA Science: Jan 24, 2004 | GISS: Jan 25, 2004 | Time zone. |
| Ingenuity end | Last flight: Jan 18, 2024 | Mission ended: Jan 25, 2024 | Both correct, but they mean different things. |
| Apollo 12 ascent-stage impact distance | NASA: about 40 miles from the station | NSSDCA: about 60 km | 40 mi ≈ 64 km, so they agree. |
| Moon illumination "tonight" | One planning note gave ≈ 26% | Ephemeris file at 7–9 PM EST: 27.2–27.9% | 26% matches mid-afternoon. Use 27–28% for the evening. |

---

## 8. Not verified: do not state these as fact

| Claim | Why it is not verified | What would confirm it |
|---|---|---|
| Apollo 12 exhaust **sandblasted or pitted** Surveyor 3 | Not stated on any page read. The NTRS abstract (Metzger et al.) says the plume "tended to remove more dust than it had deposited". | The full NTRS 20120000029 PDF, or the 1971 NASA report "Analysis of Surveyor 3 Material and Photographs Returned by Apollo 12" |
| Rocket-blown dust flies on **flat, low-angle paths** | Not on any page read. **Interpretation:** with no air there is no drag, so grains follow ballistic paths set only by launch speed and angle. | NTRS 20210020838 PDF (Batcheldor, Mantovani, Wittal 2021) or other plume-ejecta papers |
| The Moon "rang like a bell for about an hour" | Not found in that wording on a page read | Use the verified Apollo 12 wording in section 5 |
| The three Lunar Roving Vehicles are still on the Moon | The NSSDCA LRV page does not say | NASA ALSJ or LRO imagery pages |
| Perseverance landed at 18.4447°N, 77.4508°E, at "Octavia E. Butler Landing" | Seen only in search snippets. The NASA GISS table gives 18.44°N, 77.45°E. | https://photojournal.jpl.nasa.gov/catalog/PIA24483 |
| Lunar module "gold skin" is thin sheets with netting | No source read | An NTRS lunar module thermal-control document |
| Ingenuity's status in 2026 | Latest source read is from Dec 2024 | A 2025–2026 JPL update |
| Apollo 12, 14, 15 and 16 seismometers formed a network | Only Apollo 12's dates and the shared shutdown were read | NSSDCA Passive Seismic Experiment records for 14, 15 and 16 |
| The challenge's listed resources | Site blocked (section 1) | Pasted challenge text |

---

## 9. Source log

| Source | URL | Page date shown | Accessed | Method |
|---|---|---|---|---|
| Weather on the Moon | https://science.nasa.gov/moon/weather-on-the-moon/ | updated Feb 12, 2026 | 2026-11-14 | web read |
| Moon Facts | https://science.nasa.gov/moon/facts/ | updated Feb 12, 2026 | 2026-11-14 | web read |
| Water & Ices on the Moon | https://science.nasa.gov/moon/moon-water-and-ices/ | updated Feb 12, 2026 | 2026-11-14 | web read |
| Moonquakes | https://science.nasa.gov/moon/moonquakes/ | updated Feb 12, 2026 | 2026-11-14 | web read |
| 10 Things: Dust in the Wind | https://science.nasa.gov/solar-system/10-things-dust-in-the-wind-on-mars-and-well-beyond/ | Jul 26, 2022; updated Nov 5, 2024 | 2026-11-14 | web read |
| Apollo 11 mission summary (NSSDCA) | https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo11info.html | — | 2026-11-14 | web read |
| Apollo 11 LM / EASEP (NSSDCA) | https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-059C | — | 2026-11-14 | web read |
| Apollo 11 (NASA) | https://www.nasa.gov/mission/apollo-11/ | updated Mar 18, 2026 | 2026-11-14 | web read |
| Apollo 12 LM / ALSEP (NSSDCA) | https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-099C | — | 2026-11-14 | web read |
| Apollo 12: The Pinpoint Mission | https://www.nasa.gov/missions/apollo/apollo-12-the-pinpoint-mission/ | Jul 8, 2009; updated Sep 29, 2023 | 2026-11-14 | web read |
| Apollo 12 and Surveyor 3 (image) | https://science.nasa.gov/resource/apollo-12-and-surveyor-3/ | updated Feb 12, 2025 | 2026-11-14 | web read |
| Apollo 13 S-IVB (NSSDCA) | https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1970-029B | — | 2026-11-14 | web read |
| Apollo LRV (NSSDCA) | https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo_lrv.html | — | 2026-11-14 | web read |
| Apollo 11 retroreflector (ILRS) | https://ilrs.gsfc.nasa.gov/missions/satellite_missions/current_missions/ap11_general.html | "Sep 17, 2012" (unreliable) | 2026-11-14 | web read |
| Surveyor III dust deposits (NTRS) | https://ntrs.nasa.gov/citations/20120000029 | 2011/2012 | 2026-11-14 | abstract page |
| Lander plume dust (NTRS) | https://ntrs.nasa.gov/citations/20205003590 | 2020 | 2026-11-14 | abstract page |
| DERT ejecta radar (NTRS) | https://ntrs.nasa.gov/citations/20230013044 | 2023 | 2026-11-14 | abstract page |
| Dust sensor tests (NASA) | https://www.nasa.gov/directorates/stmd/nasa-supports-tests-of-dust-sensor-to-aid-lunar-landings/ | Oct 27, 2023 | 2026-11-14 | web read |
| Ice Confirmed at the Moon's Poles (JPL) | https://www.jpl.nasa.gov/news/ice-confirmed-at-the-moons-poles/ | Aug 20, 2018 | 2026-11-14 | web read |
| LCROSS impact site | https://science.nasa.gov/image-detail/20110615lcross/ | updated Jan 26, 2024 | 2026-11-14 | web read |
| Mars Facts | https://science.nasa.gov/mars/facts/ | updated Jul 10, 2026 | 2026-11-14 | web read |
| Mars Fact Sheet (NSSDCA) | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html | updated May 19, 2025 | 2026-11-14 | web read |
| Mars24 landers (NASA GISS) | https://www.giss.nasa.gov/tools/mars24/help/landers.html | updated Apr 3, 2025 | 2026-11-14 | web read |
| Mars 2020 Perseverance | https://science.nasa.gov/mission/mars-2020-perseverance/ | updated Oct 14, 2026 | 2026-11-14 | web read |
| Ingenuity mission page | https://science.nasa.gov/mission/mars-2020-perseverance/ingenuity-mars-helicopter/ | updated Sep 22, 2026 | 2026-11-14 | web read |
| Ingenuity mission ends (NASA) | https://www.nasa.gov/news-release/after-three-years-on-mars-nasas-ingenuity-helicopter-mission-ends/ | Jan 25, 2024 | 2026-11-14 | web read |
| Ingenuity accident investigation (JPL) | https://www.jpl.nasa.gov/news/nasa-performs-first-aircraft-accident-investigation-on-another-world/ | Dec 11, 2024 | 2026-11-14 | web read |
| Helicopter spots landing gear (JPL) | https://www.jpl.nasa.gov/news/nasas-mars-helicopter-spots-gear-that-helped-perseverance-rover-land/ | Apr 27, 2022 | 2026-11-14 | web read |
| Opportunity mission ends | https://science.nasa.gov/missions/mer/nasas-opportunity-rover-mission-on-mars-comes-to-end/ | Feb 13, 2019 | 2026-11-14 | web read |
| Spirit | https://science.nasa.gov/mission/mer-spirit/ | — | 2026-11-14 | web read |
| Phoenix | https://science.nasa.gov/mission/phoenix/ | — | 2026-11-14 | web read |
| Phoenix ice (JPL) | https://www.jpl.nasa.gov/news/bright-chunks-at-phoenix-landers-mars-site-must-have-been-ice/ | Jun 19, 2008 | 2026-11-14 | web read |
| InSight retired (NASA) | https://www.nasa.gov/missions/insight/nasa-retires-insight-mars-lander-mission-after-years-of-science/ | Dec 21, 2022 | 2026-11-14 | web read |
| Viking 1 | https://science.nasa.gov/mission/viking-1/ | — | 2026-11-14 | web read |
| Viking 2 | https://science.nasa.gov/mission/viking-2/ | — | 2026-11-14 | web read |
| Mars Pathfinder | https://science.nasa.gov/mission/mars-pathfinder/ | — | 2026-11-14 | web read |
| Armstrong Spacesuit (NASM) | https://airandspace.si.edu/explore/stories/armstrong-suit | — | 2026-11-14 | web read |
| Jean Wilson (Smithsonian) | https://becomingvisible.si.edu/stories/hazel-fellows | — | 2026-11-14 | web read |
| Shrink-wrapping spacesuits (MIT) | https://news.mit.edu/2014/second-skin-spacesuits-0918 | Sep 18, 2014 | 2026-11-14 | web read |
| NASA media usage guidelines | https://www.nasa.gov/nasa-brand-center/images-and-media/ | updated Oct 27, 2026 | 2026-11-14 | web read |
| Horizons API docs | https://ssd-api.jpl.nasa.gov/doc/horizons.html | v1.3, June 2025 | 2026-11-14 | web read |
| HEASARC BSC5P | https://heasarc.gsfc.nasa.gov/W3Browse/star-catalog/bsc5p.html | updated Nov 10, 2026 | 2026-11-14 | web read |
| Image pages (PIA22487, PIA15116, PIA25287, PIA22077, PIA26045, PIA26236, PIA25219) | listed in section 4 | listed in section 4 | 2026-11-14 | web read |
