# Foli and ProFiles brand assets

## Asset set

The mascot **Foli** is an original ProFiles character created for the project. It has a rounded textile body, a star-tipped antenna, a small folder emblem and a sky-blue, lavender and coral palette.

| File | Use | Dimensions |
| --- | --- | ---: |
| `frontend/public/brand/profiles-brand-mark.png` | Mascot integrated into the folder; navbar, wordmark lockup and brand illustration | 768 × 768 |
| `frontend/public/brand/profiles-foli.png` | Full-body transparent illustration for landing and product screens | 768 × 918 |
| `frontend/public/brand/profiles-foli-avatar.png` | Square face-and-antenna crop for small avatar contexts | 256 × 256 |
| `frontend/public/brand/favicon-16.png` | Browser tab icon | 16 × 16 |
| `frontend/public/brand/favicon-32.png` | Browser tab icon | 32 × 32 |
| `frontend/public/brand/favicon-64.png` | High-density browser tab icon | 64 × 64 |

`BrandIcon` uses the integrated raster mark and retains its original folder SVG as an image-load fallback. `FoliMascot` exposes the avatar and full illustration variants. Decorative image uses have empty alternative text; the standalone mascot component has a descriptive alternative by default.

## Provenance and distribution

The art was generated in this development session with OpenAI image generation from a written character description. The reference file `logo_web.jpg` was inspected only for broad mood (soft texture and friendly expression); it was not uploaded to the image generation tool, edited, traced, sampled, or included in the generated output. The integrated logo was created from the newly generated Foli artwork. The background was removed from generated outputs and the resulting transparent PNGs were resized for their intended uses.

OpenAI's [Terms of Use](https://openai.com/policies/row-terms-of-use/) state that, between the user and OpenAI and to the extent permitted by applicable law, the user owns generated output; they also state that outputs may not be unique and that similar output may be generated for other users. This records provenance and the terms basis for distribution; it is not a legal opinion or a guarantee of exclusive rights, trademark availability, or copyright protection in every jurisdiction. ProFiles intends to distribute these project assets under its repository's MIT license. Keep this provenance record with the image files and review any future mascot changes before release.

`logo_web.jpg` and `frontend/public/profiles-mascot.png` remain excluded from Git. Do not add either file to a public build or package.
