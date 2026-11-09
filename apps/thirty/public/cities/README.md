# City grids

`scripts/import-city.py` makes each `{city}.bin` file. The script header gives
the file format.

## Sources

| Layer | Source | Licence |
|---|---|---|
| `elev` | Copernicus DEM GLO-30, from the public AWS bucket `copernicus-dem-30m` | Copernicus DEM licence (free use, attribution required) |
| `water` | OpenStreetMap, through the Overpass API | ODbL 1.0 |
| `pop` | GHSL GHS-POP R2023A, epoch 2020, 100 m | CC BY 4.0 |
| `jobs` | GHSL GHS-BUILT-V R2023A, non-residential (NRES) built volume, epoch 2020, 100 m | CC BY 4.0 |

The `jobs` layer is a proxy. It uses built volume, because volume counts
floors. The built surface layer (GHS-BUILT-S NRES) puts the London peak in
the Dagenham sheds.

The `water` layer comes from OpenStreetMap data. Thus the `.bin` files are
under the ODbL too.

## Attribution

The app must show this text when it shows a city grid:

> Water © OpenStreetMap contributors (ODbL). Population and buildings: GHSL,
> © European Union, JRC (CC BY 4.0). Height: Copernicus DEM GLO-30, produced
> using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and
> Space GmbH 2014-2018, provided under COPERNICUS by the European Union and
> ESA. All rights reserved.

## Citations

- Schiavina M., Freire S., Carioli A., MacManus K. (2023). GHS-POP R2023A.
  European Commission, Joint Research Centre. doi:10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE
- Pesaresi M., Politis P. (2023). GHS-BUILT-V R2023A. European Commission,
  Joint Research Centre. doi:10.2905/AB2F107A-03CD-47A3-85E5-139D8EC63283
