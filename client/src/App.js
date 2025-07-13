import { useState, useEffect, useMemo } from 'react'; // Import useMemo
import { MapContainer, TileLayer, useMap, useMapEvents, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

// Fix for default marker icon issue in Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

// --- Helper Component to Update Map View ---
function MapUpdater({ bounds, center }) {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
      if (center) {
        map.flyTo(center, 13);
      } else if (bounds) {
        map.fitBounds(bounds);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [bounds, center, map]); // These dependencies should now be stable references
  return null;
}

// --- Component to Handle Map Clicks and Set Marker ---
function MapClickEventHandler({ setLatitude, setLongitude, setMarkerPosition, setMapCenter }) {
  useMapEvents({
    click: (e) => {
      const clickedLat = e.latlng.lat;
      let clickedLon = e.latlng.lng;

      if (clickedLon > 180) {
        clickedLon = clickedLon % 360;
        if (clickedLon > 180) clickedLon -= 360;
      } else if (clickedLon < -180) {
        clickedLon = clickedLon % 360;
        if (clickedLon < -180) clickedLon += 360;
      }

      setLatitude(clickedLat.toFixed(6));
      setLongitude(clickedLon.toFixed(6));
      setMarkerPosition([clickedLat, clickedLon]);
      setMapCenter([clickedLat, clickedLon]);
    },
  });
  return null;
}

function App() {
  const [latitude, setLatitude] = useState('35.4393');
  const [longitude, setLongitude] = useState('-82.2465');
  const [date1, setDate1] = useState('2024-09-16');
  const [date2, setDate2] = useState('2024-10-12');
  const [cloudCover, setCloudCover] = useState(20); // New state for cloud cover

  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  
  const [image1Info, setImage1Info] = useState(null);
  const [image2Info, setImage2Info] = useState(null);

  const [isImage1Visible, setIsImage1Visible] = useState(true);

  const [mapCenter, setMapCenter] = useState(null);
  const [markerPosition, setMarkerPosition] = useState(null);

  useEffect(() => {
    const latNum = parseFloat(latitude);
    const lonNum = parseFloat(longitude);
    if (!isNaN(latNum) && !isNaN(lonNum) && latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180) {
      setMarkerPosition([latNum, lonNum]);
      // Ensure mapCenter is only set if it truly needs to change
      setMapCenter(prev => {
        if (prev && prev[0] === latNum && prev[1] === lonNum) return prev;
        return [latNum, lonNum];
      });
    } else {
      setMarkerPosition(null);
    }
  }, [latitude, longitude]);

  const handleLatitudeChange = (event) => {
    setLatitude(event.target.value);
    if (errors.latitude) {
      setErrors(prevErrors => ({...prevErrors, latitude: null}));
    }
  }

  const handleLongitudeChange = (event) => {
    setLongitude(event.target.value);
    if (errors.longitude) {
      setErrors(prevErrors => ({...prevErrors, longitude: null}));
    }
  }

  const handleDate1Change = (event) => {
    setDate1(event.target.value);
    if (errors.date1) {
      setErrors(prevErrors => ({...prevErrors, date1: null}));
    }
  }

  const handleDate2Change = (event) => {
    setDate2(event.target.value);
    if (errors.date2) {
      setErrors(prevErrors => ({...prevErrors, date2: null}));
    }
  }

  const handleCloudCoverChange = (event) => {
    setCloudCover(parseInt(event.target.value, 10));
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    
    const newErrors = {};
    const latNum = parseFloat(latitude);
    const lonNum = parseFloat(longitude);

    if (isNaN(latNum) || !latitude) newErrors.latitude = 'Latitude is required and must be a number.';
    else if (latNum < -90 || latNum > 90) newErrors.latitude = 'Must be between -90 and 90.';
    
    if (isNaN(lonNum) || !longitude) newErrors.longitude = 'Longitude is required and must be a number.';
    else if (lonNum < -180 || lonNum > 180) newErrors.longitude = 'Must be between -180 and 180.';
    
    if (!date1) newErrors.date1 = 'Date 1 is required.';
    if (!date2) newErrors.date2 = 'Date 2 is required.';

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      setImage1Info(null);
      setImage2Info(null);
      setApiError('');
      setMapCenter(null);
      setMarkerPosition(null);
      return;
    }

    setIsLoading(true);
    setApiError('');
    setImage1Info(null); // Clear existing images on new search
    setImage2Info(null);

    try {
      const apiUrl = `http://localhost:8080/api/change-detection?lat=${latitude}&lon=${longitude}&date1=${date1}&date2=${date2}&cloudCover=${cloudCover}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      
      // Only update state if the new info is actually different
      setImage1Info(prev => {
        if (prev && prev.imageUrl === data.image1.imageUrl && JSON.stringify(prev.bounds) === JSON.stringify(data.image1.bounds)) {
          return prev;
        }
        return data.image1;
      });
      setImage2Info(prev => {
        if (prev && prev.imageUrl === data.image2.imageUrl && JSON.stringify(prev.bounds) === JSON.stringify(data.image2.bounds)) {
          return prev;
        }
        return data.image2;
      });

      // Ensure map center is only updated if it truly needs to change
      setMapCenter(prev => {
        if (prev && prev[0] === latNum && prev[1] === lonNum) return prev;
        return [latNum, lonNum];
      });
      setMarkerPosition([latNum, lonNum]);

    } catch (error) {
      console.error("Failed to fetch images:", error);
      setApiError(error.message);
      setMapCenter(null);
      setMarkerPosition(null);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Use useMemo to stabilize bounds and center props for MapUpdater ---
  const mapUpdaterBounds = useMemo(() => {
    if (image1Info?.bounds) return image1Info.bounds;
    if (image2Info?.bounds) return image2Info.bounds;
    return null;
  }, [image1Info?.bounds, image2Info?.bounds]);

  const mapUpdaterCenter = useMemo(() => mapCenter, [mapCenter]);

  return (
    <div className="app-container">
      <div className="form-container">
        <h1>Geospatial Image Finder</h1>
        <p className="subtitle">Enter coordinates and two dates to find satellite images for comparison.</p>
        <form onSubmit={handleSubmit} noValidate>
          <div className="input-group">
            <label htmlFor="latitude">Latitude</label>
            <input id="latitude" type="number" value={latitude} onChange={handleLatitudeChange} placeholder="e.g., 40.7128" />
            {errors.latitude && <p className="error-text">{errors.latitude}</p>}
          </div>

          <div className="input-group">
            <label htmlFor="longitude">Longitude</label>
            <input id="longitude" type="number" value={longitude} onChange={handleLongitudeChange} placeholder="e.g., -74.0060" />
            {errors.longitude && <p className="error-text">{errors.longitude}</p>}
          </div>

          <div className="input-group">
            <label htmlFor="date1">Image Date 1</label>
            <input id="date1" type="date" value={date1} onChange={handleDate1Change} />
            {errors.date1 && <p className="error-text">{errors.date1}</p>}
          </div>

          <div className="input-group">
            <label htmlFor="date2">Image Date 2</label>
            <input id="date2" type="date" value={date2} onChange={handleDate2Change} />
            {errors.date2 && <p className="error-text">{errors.date2}</p>}
          </div>

          <div className="input-group">
            <label htmlFor="cloudCover">Max Cloud Cover: {cloudCover}%</label>
            <input 
              id="cloudCover" 
              type="range" 
              min="1" 
              max="100" 
              value={cloudCover} 
              onChange={handleCloudCoverChange} 
            />
          </div>

          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Searching...' : 'Find Images'}
          </button>
          
          <div className="api-status">
            {apiError && <p className="error-text api-error">{apiError}</p>}
          </div>
        </form>
        {image1Info && image2Info && (
          <div className="image-dates-display">
            <p>Image 1 acquired: {new Date(image1Info.dateAcquired).toLocaleDateString()}</p>
            <p>Image 2 acquired: {new Date(image2Info.dateAcquired).toLocaleDateString()}</p>
            <button onClick={() => setIsImage1Visible(!isImage1Visible)} className="toggle-button">
                {isImage1Visible ? 'Hide Image 1' : 'Show Image 1'}
          </button>
          </div>
        )}
      </div>

      <div className="map-view-container">
        <MapContainer className="leaflet-map" center={[35.4393, -82.2465]} zoom={10} scrollWheelZoom={true}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {image1Info && (
            <TileLayer
              url={image1Info.tileUrlTemplate} // Use the template from the backend
              bounds={image1Info.bounds}
              opacity={isImage1Visible ? 1 : 0}
              tms={false} // Important: Standard web maps use TMS=false
              zIndex={3} // Ensure it's on top of the second image
            />
          )}

          {image2Info && (
            <TileLayer
              url={image2Info.tileUrlTemplate} // Use the template from the backend
              bounds={image2Info.bounds}
              opacity={1} // Make second image semi-transparent
              tms={false}
              zIndex={2}
            />
          )}

          {markerPosition && (
            <Marker position={markerPosition}>
              <Popup>
                Latitude: {markerPosition[0].toFixed(4)} <br /> Longitude: {markerPosition[1].toFixed(4)}
              </Popup>
            </Marker>
          )}

          <MapUpdater bounds={mapUpdaterBounds} center={mapUpdaterCenter} />
          <MapClickEventHandler 
            setLatitude={setLatitude} 
            setLongitude={setLongitude} 
            setMarkerPosition={setMarkerPosition}
            setMapCenter={setMapCenter}
          />
        </MapContainer>
      </div>
    </div>
  );
}

export default App;