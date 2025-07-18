from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import requests
import json
import logging
from datetime import datetime, timedelta
from rio_tiler.io import COGReader 
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.models import ImageData
from urllib.parse import urlencode

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

STAC_API_URL = "https://earth-search.aws.element84.com/v1/search"

# --- Helper function to fetch a single STAC feature ---
def fetch_stac_feature(lat, lon, date_str, cloud_cover_lt=10, date_window_days=15):
    """
    Fetches the best STAC feature (image metadata) for a given point and date range.
    Returns the feature or None if not found.
    """
    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        window_start_date = target_date - timedelta(days=date_window_days)
        window_end_date = target_date + timedelta(days=date_window_days)
        datetime_range = f"{window_start_date.isoformat()}T00:00:00Z/{window_end_date.isoformat()}T23:59:59Z"
    except ValueError:
        logging.error(f"Invalid date format: {date_str}. Expected YYYY-MM-DD")
        return None

    stac_request_body = {
        "collections": ["sentinel-2-l2a"],
        "intersects": {
            "type": "Point",
            "coordinates": [lon, lat],
        },
        "datetime": datetime_range,
        "limit": 1,
        "sortby": [
            {"field": "properties.eo:cloud_cover", "direction": "asc"},
            {"field": "properties.datetime", "direction": "desc"}
        ],
        "query": {
            "eo:cloud_cover": {"lt": cloud_cover_lt}
        }
    }

    logging.info(f"STAC Query for date {date_str}, Datetime Range: {datetime_range}")

    try:
        response = requests.post(STAC_API_URL, json=stac_request_body)
        response.raise_for_status()
        stac_response = response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to call STAC API for {date_str}: {e}")
        return None

    if not stac_response.get("features"):
        logging.info(f"No features found for {date_str} with cloud_cover < {cloud_cover_lt}%")
        return None

    return stac_response["features"][0]

class ImageInfo:
    def __init__(self, tile_url_template, bounds, date_acquired):
        self.tileUrlTemplate = tile_url_template
        self.bounds = bounds
        self.date_acquired = date_acquired

    def to_dict(self):
        return {
            "tileUrlTemplate": self.tileUrlTemplate,
            "bounds": self.bounds,
            "dateAcquired": self.date_acquired
        }

@app.route("/api/tiles/<int:z>/<int:x>/<int:y>", methods=["GET"])
def tile_server(z, x, y):
    """
    This endpoint generates and serves a map tile on the fly.
    It expects a 'url' query parameter with the COG URL.
    """
    cog_url = request.args.get("url")
    if not cog_url:
        return "Missing 'url' query parameter", 400

    try:
        with COGReader(cog_url) as cog:
            # The 'visual' GeoTIFF is a simple RGB image, so we use bands 1, 2, and 3.
            tile_data, tile_mask = cog.tile(x, y, z, tilesize=256, indexes=(1, 2, 3))

        # Create an ImageData object from the tile data
        img = ImageData(tile_data, tile_mask)
        
        # The tile is returned as a PNG image
        return Response(img.render(img_format="PNG"), mimetype="image/png")

    except TileOutsideBounds:
        # This is expected if the map requests tiles outside the image bounds
        return Response(b"", status=204) # Return empty bytes with 204
    except Exception as e:
        logging.error(f"Tile server error for URL {cog_url}: {e}")
        return "Failed to generate tile", 500

# --- MODIFIED: Main API Endpoint ---
@app.route("/api/change-detection", methods=["GET"])
def get_change_detection_handler():
    lat_str = request.args.get("lat")
    lon_str = request.args.get("lon")
    date1_str = request.args.get("date1")
    date2_str = request.args.get("date2")
    cloud_cover_str = request.args.get("cloudCover")

    if not all([lat_str, lon_str, date1_str, date2_str]):
        return jsonify({"error": "Missing required query parameters"}), 400

    try:
        lat = float(lat_str)
        lon = float(lon_str)
    except ValueError:
        return jsonify({"error": "Invalid coordinates"}), 400
    
    cloud_cover = 20 # Default value
    if cloud_cover_str:
        try:
            cloud_cover = int(cloud_cover_str)
            if not (1 <= cloud_cover <= 100):
                return jsonify({"error": "Cloud cover must be a number between 1 and 100"}), 400
        except ValueError:
            return jsonify({"error": "Invalid cloud cover value"}), 400

    feature1 = fetch_stac_feature(lat, lon, date1_str, cloud_cover_lt=cloud_cover)
    if not feature1:
        return jsonify({"error": f"No clear image found for Date 1 ({date1_str}) with cloud cover less than {cloud_cover}%."}), 404

    feature2 = fetch_stac_feature(lat, lon, date2_str, cloud_cover_lt=cloud_cover)
    if not feature2:
        return jsonify({"error": f"No clear image found for Date 2 ({date2_str}) with cloud cover less than {cloud_cover}%."}), 404

    # Get the URL of the 'visual' asset (the TCI GeoTIFF)
    cog_url1 = feature1.get("assets", {}).get("visual", {}).get("href")
    if not cog_url1:
        return jsonify({"error": "No 'visual' asset URL found for Date 1."}), 404

    # Create the tile URL template for the frontend
    tile_server_url1 = f"http://localhost:8080/api/tiles/{{z}}/{{x}}/{{y}}?{urlencode({'url': cog_url1})}"

    bbox1 = feature1.get("bbox")
    leaflet_bounds1 = [[bbox1[1], bbox1[0]], [bbox1[3], bbox1[2]]]
    image1_info = ImageInfo(tile_server_url1, leaflet_bounds1, feature1.get("properties", {}).get("datetime")).to_dict()

    cog_url2 = feature2.get("assets", {}).get("visual", {}).get("href")
    if not cog_url2:
        return jsonify({"error": "No 'visual' asset URL found for Date 2."}), 404

    tile_server_url2 = f"http://localhost:8080/api/tiles/{{z}}/{{x}}/{{y}}?{urlencode({'url': cog_url2})}"

    bbox2 = feature2.get("bbox")
    leaflet_bounds2 = [[bbox2[1], bbox2[0]], [bbox2[3], bbox2[2]]]
    image2_info = ImageInfo(tile_server_url2, leaflet_bounds2, feature2.get("properties", {}).get("datetime")).to_dict()

    api_response = {"image1": image1_info, "image2": image2_info}
    return jsonify(api_response), 200

if __name__ == "__main__":
    print("Starting server on port 8080...")
    app.run(debug=True, port=8080)