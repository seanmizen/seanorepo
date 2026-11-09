# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = [
#   "numpy",
#   "pillow",
#   "pyproj",
#   "rasterio",
#   "scipy",
#   "shapely",
# ]
# ///
# Where: apps/thirty, on a dev machine with internet access.
# When: by hand, to add a city or to refresh one. The output is checked in.
# Why: makes the real-data city grid that the app loads from public/cities/{name}.bin.
# Usage: uv run apps/thirty/scripts/import-city.py london [--cache DIR] [--preview DIR]
#
# Output: one little-endian Float32 array [w, cellM, elev*n, water*n, pop*n, jobs*n], n = w*w.
# The grid is square and row-major. Row 0 is the north edge. Column 0 is the west edge.
# The grid is in UTM, centred on the city centre.
# Sources and licences: see public/cities/README.md.

import argparse
import io
import json
import math
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from pyproj import CRS, Transformer
from rasterio.errors import RasterioIOError
from rasterio.features import rasterize
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds
from scipy import ndimage
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union

CITIES = {
    "london": {"lat": 51.5072, "lon": -0.1276, "w": 256, "cellM": 250},
    "lisbon": {"lat": 38.70, "lon": -9.17, "w": 256, "cellM": 200},
}

# Water is classified on a finer grid first. Each cell holds FINE x FINE fine pixels.
FINE = 5

DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif"
GHSL_URL = (
    "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/{group}/{product}/V1-0/tiles/"
    "{product}_V1_0_R{row}_C{col}.zip"
)
POP = ("GHS_POP_GLOBE_R2023A", "GHS_POP_E2020_GLOBE_R2023A_54009_100")
NRES = ("GHS_BUILT_S_GLOBE_R2023A", "GHS_BUILT_S_NRES_E2020_GLOBE_R2023A_54009_100")
MOLLWEIDE = "ESRI:54009"
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
UA = {"User-Agent": "seanorepo-thirty-import-city/1.0"}

WATER_SEA = 1
WATER_RIVER = 2


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def fetch(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


class Grid:
    """The output grid in UTM, with row 0 at the north edge."""

    def __init__(self, lat, lon, w, cell):
        zone = int((lon + 180) // 6) + 1
        self.crs = CRS.from_epsg((32600 if lat >= 0 else 32700) + zone)
        cx, cy = Transformer.from_crs(4326, self.crs, always_xy=True).transform(lon, lat)
        half = w * cell / 2
        self.w, self.cell = w, cell
        self.bounds = (cx - half, cy - half, cx + half, cy + half)
        self.transform = from_origin(cx - half, cy + half, cell, cell)
        self.fine_transform = from_origin(cx - half, cy + half, cell / FINE, cell / FINE)

    def bounds_in(self, crs, margin):
        l, b, r, t = transform_bounds(self.crs, crs, *self.bounds, densify_pts=64)
        return (l - margin, b - margin, r + margin, t + margin)


def warp_mosaic(paths, grid, src_crs, margin, nodata):
    """Mosaics the source rasters over the grid, then averages them into the grid cells."""
    srcs = []
    for p in paths:
        try:
            srcs.append(rasterio.open(p))
        except RasterioIOError:
            log(f"  skip {p} (not found)")
    if not srcs:
        raise SystemExit("No source raster covers this grid.")
    bounds = grid.bounds_in(src_crs, margin)
    arr, tr = merge(srcs, bounds=bounds, nodata=nodata)
    for s in srcs:
        s.close()
    out = np.full((grid.w, grid.w), np.nan, dtype=np.float32)
    reproject(
        source=arr[0].astype(np.float32),
        destination=out,
        src_transform=tr,
        src_crs=src_crs,
        src_nodata=nodata,
        dst_transform=grid.transform,
        dst_crs=grid.crs,
        dst_nodata=np.nan,
        resampling=Resampling.average,
    )
    return out


def load_elev(grid):
    """Copernicus GLO-30 DEM, read in place from the public S3 COGs."""
    l, b, r, t = grid.bounds_in(4326, 0.01)
    paths = []
    for lat in range(math.floor(b), math.floor(t) + 1):
        for lon in range(math.floor(l), math.floor(r) + 1):
            ns = f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}"
            ew = f"{'E' if lon >= 0 else 'W'}{abs(lon):03d}"
            n = f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM"
            paths.append(DEM_URL.format(n=n))
    log(f"elev: {len(paths)} DEM tile(s)")
    elev = warp_mosaic(paths, grid, CRS.from_epsg(4326), 0.01, -32767.0)
    return np.nan_to_num(np.maximum(elev, 0), nan=0.0)


def ghsl_tiles(grid, group, product, cache):
    """Downloads the GHSL tiles that cover the grid. Tiles are 1000 km squares in Mollweide."""
    l, b, r, t = grid.bounds_in(MOLLWEIDE, 1000)
    paths = []
    for row in range(int((9_000_000 - t) // 1e6) + 1, int((9_000_000 - b) // 1e6) + 2):
        for col in range(int((l + 18_041_000) // 1e6) + 1, int((r + 18_041_000) // 1e6) + 2):
            tif = cache / f"{product}_V1_0_R{row}_C{col}.tif"
            if not tif.exists():
                url = GHSL_URL.format(group=group, product=product, row=row, col=col)
                log(f"  download {url}")
                with zipfile.ZipFile(io.BytesIO(fetch(url))) as z:
                    tif.write_bytes(z.read(tif.name))
            paths.append(tif)
    return paths


def load_ghsl(grid, src, cache):
    """Returns the sum of a GHSL 100 m count layer over each grid cell."""
    paths = ghsl_tiles(grid, *src, cache)
    log(f"{src[1]}: {len(paths)} tile(s)")
    mean = warp_mosaic(paths, grid, CRS.from_string(MOLLWEIDE), 1000, -200.0)
    # Mollweide is equal-area, so each source pixel is 100 m x 100 m.
    # The cell mean times the pixels per cell gives the cell sum.
    return np.nan_to_num(np.maximum(mean, 0), nan=0.0) * (grid.cell / 100) ** 2


def overpass(grid, cache, name):
    path = cache / f"{name}-osm.json"
    if path.exists():
        return json.loads(path.read_text())
    s, w, n, e = (lambda b: (b[1], b[0], b[3], b[2]))(grid.bounds_in(4326, 0.01))
    bb = f"({s:.5f},{w:.5f},{n:.5f},{e:.5f})"
    sel = ["natural=water", "waterway=riverbank", "landuse=reservoir"]
    parts = [f'{t}["{k}"="{v}"]{bb};' for k, v in (x.split("=") for x in sel) for t in ("way", "relation")]
    q = f'[out:json][timeout:300];({"".join(parts)}way["natural"="coastline"]{bb};);out geom;'
    body = urllib.parse.urlencode({"data": q}).encode()
    for url in OVERPASS:
        try:
            log(f"water: query {url}")
            data = json.loads(fetch(url, body))
            path.write_text(json.dumps(data))
            return data
        except Exception as err:  # noqa: BLE001
            log(f"  failed: {err}")
    raise SystemExit("All Overpass servers failed.")


def water_layer(grid, osm):
    """Rasterises OSM water on the fine grid, then gives each cell the majority class."""
    proj = Transformer.from_crs(4326, grid.crs, always_xy=True)

    def line(geom):
        xs, ys = proj.transform([p["lon"] for p in geom], [p["lat"] for p in geom])
        return list(zip(xs, ys))

    sea_lines, rivers, lakes = [], [], []
    for el in osm["elements"]:
        tags = el.get("tags", {})
        if tags.get("natural") == "coastline":
            sea_lines.append(line(el["geometry"]))
            continue
        is_river = tags.get("water") == "river" or tags.get("waterway") == "riverbank"
        if el["type"] == "way":
            pts = line(el["geometry"])
            if len(pts) < 4 or pts[0] != pts[-1]:
                continue
            geom = Polygon(pts).buffer(0)
        else:
            rings = {"outer": [], "inner": []}
            for m in el.get("members", []):
                if m["type"] == "way" and "geometry" in m and m["role"] in rings:
                    rings[m["role"]].append(LineString(line(m["geometry"])))
            outer = unary_union([p.buffer(0) for p in polygonize(rings["outer"])])
            inner = unary_union([p.buffer(0) for p in polygonize(rings["inner"])])
            geom = outer.difference(inner)
        if not geom.is_empty:
            (rivers if is_river else lakes).append(geom)

    fw = grid.w * FINE
    shape = (fw, fw)

    def burn(geoms):
        if not geoms:
            return np.zeros(shape, bool)
        return rasterize(((g, 1) for g in geoms), out_shape=shape, transform=grid.fine_transform).astype(bool)

    sea = sea_mask(grid, sea_lines, shape)
    still = burn(lakes) | sea
    # Sea and lakes win over rivers. So a river polygon in an estuary stays sea.
    river = burn(rivers) & ~still

    def frac(m):
        return m.reshape(grid.w, FINE, grid.w, FINE).mean(axis=(1, 3))

    f1, f2 = frac(still), frac(river)
    water = np.zeros((grid.w, grid.w), np.float32)
    wet = f1 + f2 > 0.5
    water[wet & (f1 >= f2)] = WATER_SEA
    water[wet & (f1 < f2)] = WATER_RIVER
    return water


def sea_mask(grid, lines, shape):
    """Finds the sea on the fine grid from OSM coastline ways.

    Coastline ways have land on the left and sea on the right.
    The coastline pixels form a wall. Each region inside the walls
    takes a vote from points just left and right of each segment.
    """
    if not lines:
        return np.zeros(shape, bool)
    wall = rasterize(((LineString(p), 1) for p in lines), out_shape=shape,
                     transform=grid.fine_transform, all_touched=True).astype(bool)
    labels, count = ndimage.label(~wall)
    inv = ~grid.fine_transform
    step = 1.5 * grid.cell / FINE
    votes = np.zeros((2, count + 1))
    for pts in lines:
        p = np.asarray(pts)
        d = p[1:] - p[:-1]
        length = np.hypot(d[:, 0], d[:, 1])
        ok = length > 0
        mid = (p[1:] + p[:-1])[ok] / 2
        right = np.stack([d[ok, 1], -d[ok, 0]], axis=1) / length[ok, None]
        for side, sign in ((0, -1), (1, 1)):
            q = mid + sign * step * right
            col, row = inv * (q[:, 0], q[:, 1])
            row, col = np.floor(row).astype(int), np.floor(col).astype(int)
            inside = (row >= 0) & (row < shape[0]) & (col >= 0) & (col < shape[1])
            np.add.at(votes[side], labels[row[inside], col[inside]], 1)
    is_sea = votes[1] > votes[0]
    is_sea[0] = False
    sea = is_sea[labels]
    # A wall pixel joins the sea when most of its neighbours are sea.
    near = ndimage.uniform_filter(sea.astype(np.float32), size=3)
    return sea | (wall & (near >= 0.5))


def preview(name, layers, out):
    out.mkdir(parents=True, exist_ok=True)
    colours = np.array([[236, 228, 210], [40, 90, 170], [90, 190, 230]], np.uint8)
    for key, a in layers.items():
        if key == "water":
            img = colours[a.astype(int)]
        else:
            v = np.sqrt(a / a.max()) if a.max() > 0 else a
            img = (v * 255).astype(np.uint8)
        path = out / f"{name}-{key}.png"
        Image.fromarray(img).resize((a.shape[1] * 3, a.shape[0] * 3), Image.NEAREST).save(path)
        log(f"preview: {path}")


def main():
    ap = argparse.ArgumentParser(description="Make a city grid for the thirty app.")
    ap.add_argument("city", choices=sorted(CITIES))
    ap.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "thirty-cities",
                    help="Directory for downloads. Default: the system temp directory.")
    ap.add_argument("--out", type=Path, help="Output file. Default: public/cities/{city}.bin.")
    ap.add_argument("--preview", type=Path, help="Write a PNG of each layer to this directory.")
    args = ap.parse_args()

    c = CITIES[args.city]
    args.cache.mkdir(parents=True, exist_ok=True)
    out = args.out or Path(__file__).resolve().parent.parent / "public" / "cities" / f"{args.city}.bin"
    grid = Grid(c["lat"], c["lon"], c["w"], c["cellM"])
    log(f"{args.city}: {grid.w}x{grid.w} cells of {grid.cell} m in {grid.crs}")

    elev = load_elev(grid)
    water = water_layer(grid, overpass(grid, args.cache, args.city))
    pop = load_ghsl(grid, POP, args.cache)
    jobs = load_ghsl(grid, NRES, args.cache)
    pop[water > 0] = 0
    jobs[water > 0] = 0

    head = np.array([grid.w, grid.cell], np.float32)
    data = np.concatenate([head] + [a.astype(np.float32).ravel() for a in (elev, water, pop, jobs)])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data.astype("<f4").tobytes())
    log(f"wrote {out} ({out.stat().st_size} bytes)")
    if args.preview:
        preview(args.city, {"elev": elev, "water": water, "pop": pop, "jobs": jobs}, args.preview)


if __name__ == "__main__":
    main()
