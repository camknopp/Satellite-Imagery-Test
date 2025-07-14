import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import logo from './logo.png';

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

  const [selectedComputations, setSelectedComputations] = useState([]);
  const [computationResults, setComputationResults] = useState({});
  const [isCalculating, setIsCalculating] = useState(false);
  const [showCalculationResults, setShowCalculationResults] = useState(false);

  // Available computation types
  const computationCategories = {
    "Disaster Response & Monitoring": [
      'Differenced Normalized Burn Ratio (dNBR)',
      'Normalized Difference Flood Index (NDFI)',
      'Building Damage Proxy Map (Simulated)',
      'Landslide Susceptibility Index (Simulated)'
    ],
    "Agriculture & Forestry": [
      'NDVI (Normalized Difference Vegetation Index)',
      'EVI (Enhanced Vegetation Index)',
      'NDMI (Normalized Difference Moisture Index)',
      'Chlorophyll Index (Simulated)'
    ],
    "Water Resources": [
      'NDWI (Normalized Difference Water Index - Surface Water)',
      'Modified Normalized Difference Water Index (MNDWI)',
      'Turbidity/Sedimentation Index (Simulated)'
    ],
    "Urban & Land Use Change": [
      'Normalized Difference Built-up Index (NDBI)',
      'Impervious Surface Change Detection (Simulated)',
      'Urban Heat Island (LST Difference - Simulated)',
      'Green Space Monitoring (Simulated)'
    ]
  };

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
      setShowCalculationResults(false); // Hide calculation results on new image search
      return;
    }

    setIsImage1Visible(true);
    setIsLoading(true);
    setApiError('');
    setImage1Info(null); // Clear existing images on new search
    setImage2Info(null);
    setShowCalculationResults(false); // Hide calculation results on new image search

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

  const handleClearAndReset = () => {
    // Clear images and related states
    setImage1Info(null);
    setImage2Info(null);
    setIsImage1Visible(true); // Reset visibility to default

    // Clear errors and API messages
    setErrors({});
    setApiError('');
    setIsLoading(false);

    // Clear computation selections and results
    setSelectedComputations([]);
    setComputationResults({});
    setIsCalculating(false);
    setShowCalculationResults(false);
  };


  const handleCategoryCheckboxChange = (category, event) => {
    const { checked } = event.target;
    const computationsInCategory = computationCategories[category];

    if (checked) {
      // Add all computations from this category that are not already selected
      setSelectedComputations(prev => [...new Set([...prev, ...computationsInCategory])]);
    } else {
      // Remove all computations from this category
      setSelectedComputations(prev => prev.filter(comp => !computationsInCategory.includes(comp)));
    }
    setShowCalculationResults(false); // Hide previous results when selection changes
  };

  const handleComputationChange = (event) => {
    const { value, checked } = event.target;
    setSelectedComputations(prev =>
      checked ? [...prev, value] : prev.filter(comp => comp !== value)
    );
    setShowCalculationResults(false); // Hide previous results when selection changes
  };

  // --- Simulate Computation Handler ---
  const handleCalculate = () => {
    setIsCalculating(true);
    setComputationResults({}); // Clear previous results

    // Simulate a delay for "computation"
    setTimeout(() => {
      const results = {};
      selectedComputations.forEach(comp => {
      selectedComputations.forEach(comp => {
        // Disaster Response & Monitoring
        if (comp.includes('dNBR')) {
          results.dNBR = (Math.random() * 1.5 - 0.5).toFixed(4); // -0.5 to 1.0, higher positive = more severe burn
        } else if (comp.includes('NDFI')) {
          results.NDFI = (Math.random() * 0.8 + 0.1).toFixed(4); // 0.1 to 0.9, higher = more water
        } else if (comp.includes('Building Damage Proxy Map')) {
          results.buildingDamage = `Estimated ${Math.floor(Math.random() * 20) + 5}% structural damage detected.`; // 5-25%
        } else if (comp.includes('Landslide Susceptibility Index')) {
            const susceptibility = Math.random();
            if (susceptibility < 0.3) results.landslideSusceptibility = 'Low';
            else if (susceptibility < 0.7) results.landslideSusceptibility = 'Medium';
            else results.landslideSusceptibility = 'High';
        }

        // Agriculture & Forestry
        else if (comp.includes('NDVI')) {
          results.NDVI = (Math.random() * 2 - 1).toFixed(4); // -1 to 1
        } else if (comp.includes('EVI')) {
          results.EVI = (Math.random() * 0.8 + 0.1).toFixed(4); // 0.1 to 0.9
        } else if (comp.includes('NDMI')) {
          results.NDMI = (Math.random() * 1.5 - 0.5).toFixed(4); // -0.5 to 1.0, higher = more moisture
        } else if (comp.includes('Chlorophyll Index')) {
            results.ChlorophyllIndex = (Math.random() * 0.5 + 0.2).toFixed(4); // 0.2 to 0.7
        }

        // Water Resources
        else if (comp.includes('NDWI (Normalized Difference Water Index - Surface Water)')) {
          results.NDWI_Surface = (Math.random() * 1.5 - 0.5).toFixed(4); // -0.5 to 1.0, positive = water
        } else if (comp.includes('MNDWI')) {
          results.MNDWI = (Math.random() * 1.5 - 0.5).toFixed(4); // -0.5 to 1.0, similar to NDWI but improved
        } else if (comp.includes('Turbidity/Sedimentation Index')) {
          results.Turbidity = (Math.random() * 0.4 + 0.05).toFixed(4); // 0.05 to 0.45, higher = more turbid
        }

        // Urban & Land Use Change
        else if (comp.includes('NDBI')) {
          results.NDBI = (Math.random() * 1.2 - 0.6).toFixed(4); // -0.6 to 0.6, higher positive = built-up
        } else if (comp.includes('Impervious Surface Change Detection')) {
          const change = (Math.random() * 20 - 10).toFixed(2); // Simulate change from -10% to +10%
          results.imperviousChange = `${Math.abs(change)}% ${change > 0 ? 'Increase' : 'Decrease'} in impervious surface`;
        } else if (comp.includes('Urban Heat Island')) {
          const tempDiff = (Math.random() * 5 + 1).toFixed(2); // Simulate 1-6 degrees difference
          results.urbanHeatIsland = `${tempDiff}°C hotter in urban core (Simulated)`;
        } else if (comp.includes('Green Space Monitoring')) {
          const greenChange = (Math.random() * 15 - 7).toFixed(2); // Simulate change from -7% to +8%
          results.greenSpaceChange = `${Math.abs(greenChange)}% ${greenChange > 0 ? 'Increase' : 'Decrease'} in green space cover`;
        }
      });
    });
      setComputationResults(results);
      setIsCalculating(false);
      setShowCalculationResults(true); // Show results after calculation
    }, 1500); // Simulate 1.5 seconds of "computation"
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
        <img src={logo} alt="Geo Compare Logo" className="app-logo" />
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

          {image1Info && image2Info && 
          <button type="button" className='reset-button' onClick={handleClearAndReset}>
            Reset
          </button>}
          
          {apiError && <div className="api-status">
            {apiError && <p className="error-text api-error">{apiError}</p>}
          </div>}
        </form>
        {image1Info && image2Info && (
          <div className="image-dates-display">
            <p>Image 1 acquired: {new Date(image1Info.dateAcquired).toLocaleDateString()}</p>
            <p>Image 2 acquired: {new Date(image2Info.dateAcquired).toLocaleDateString()}</p>
            <button onClick={() => setIsImage1Visible(!isImage1Visible)} className="toggle-button">
                {isImage1Visible ? 'Hide Image 1' : 'Show Image 1'}
            </button>
            {/* Computation Options Section */}
            <div className="computation-section">
              <h2 className="computation-title">Select Computations</h2>
              <p className="subtitle">Choose which geospatial computations you'd like to perform on the selected area. (Note: These are simulated results for demonstration purposes.)</p>
              {Object.entries(computationCategories).map(([category, computations]) => (
                <div key={category} className="computation-category">
                  <h3>
                    <span className="checkbox-label">{category}</span>
                    <input
                      type="checkbox"
                      checked={computations.every(comp => selectedComputations.includes(comp))}
                      onChange={(e) => handleCategoryCheckboxChange(category, e)}
                      className="checkbox-input"
                    />
                  </h3>
                  <div className="input-group">
                    {computations.map(option => (
                      <label key={option} className="computation-option">
                        <input
                          type="checkbox"
                          value={option}
                          checked={selectedComputations.includes(option)}
                          onChange={handleComputationChange}
                          className="checkbox-input"
                        />
                        <span className="checkbox-label">{option}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <button
                type='submit'
                onClick={handleCalculate}
                disabled={selectedComputations.length === 0 || isCalculating}
              >
                {isCalculating ? 'Calculating...' : 'Calculate Selected'}
              </button>

              {/* Computation Results Display */}
              {showCalculationResults && Object.keys(computationResults).length > 0 && (
                <div className="computation-results">
                  <h3 className="results-title">Computation Results:</h3>
                  <ul className="results-list">
                  {/* Disaster Response & Monitoring */}
                  {computationResults.dNBR && (
                    <li><span className="font-bold">dNBR (Differenced Normalized Burn Ratio):</span> {computationResults.dNBR} (Higher positive values indicate more severe burn)</li>
                  )}
                  {computationResults.NDFI && (
                    <li><span className="font-bold">NDFI (Normalized Difference Flood Index):</span> {computationResults.NDFI} (Higher values indicate presence of water)</li>
                  )}
                  {computationResults.buildingDamage && (
                    <li><span className="font-bold">Building Damage Proxy Map:</span> {computationResults.buildingDamage}</li>
                  )}
                  {computationResults.landslideSusceptibility && (
                      <li><span className="font-bold">Landslide Susceptibility Index:</span> {computationResults.landslideSusceptibility}</li>
                  )}

                  {/* Agriculture & Forestry */}
                  {computationResults.NDVI && (
                    <li><span className="font-bold">NDVI (Normalized Difference Vegetation Index):</span> {computationResults.NDVI} (Higher values indicate denser vegetation)</li>
                  )}
                  {computationResults.EVI && (
                    <li><span className="font-bold">EVI (Enhanced Vegetation Index):</span> {computationResults.EVI} (Improved vegetation indicator, especially in dense areas)</li>
                  )}
                  {computationResults.NDMI && (
                    <li><span className="font-bold">NDMI (Normalized Difference Moisture Index):</span> {computationResults.NDMI} (Indicates vegetation water content)</li>
                  )}
                  {computationResults.ChlorophyllIndex && (
                      <li><span className="font-bold">Chlorophyll Index:</span> {computationResults.ChlorophyllIndex} (Indicates chlorophyll content, related to plant health)</li>
                  )}

                  {/* Water Resources */}
                  {computationResults.NDWI_Surface && (
                    <li><span className="font-bold">NDWI (Normalized Difference Water Index - Surface Water):</span> {computationResults.NDWI_Surface} (Highlights open water bodies)</li>
                  )}
                  {computationResults.MNDWI && (
                    <li><span className="font-bold">MNDWI (Modified Normalized Difference Water Index):</span> {computationResults.MNDWI} (Enhanced water body detection)</li>
                  )}
                  {computationResults.Turbidity && (
                    <li><span className="font-bold">Turbidity/Sedimentation Index:</span> {computationResults.Turbidity} (Indicates water clarity/sediment load)</li>
                  )}

                  {/* Urban & Land Use Change */}
                  {computationResults.NDBI && (
                    <li><span className="font-bold">NDBI (Normalized Difference Built-up Index):</span> {computationResults.NDBI} (Higher values indicate built-up areas)</li>
                  )}
                  {computationResults.imperviousChange && (
                    <li><span className="font-bold">Impervious Surface Change Detection:</span> {computationResults.imperviousChange}</li>
                  )}
                  {computationResults.urbanHeatIsland && (
                    <li><span className="font-bold">Urban Heat Island (LST Difference):</span> {computationResults.urbanHeatIsland}</li>
                  )}
                  {computationResults.greenSpaceChange && (
                    <li><span className="font-bold">Green Space Monitoring:</span> {computationResults.greenSpaceChange}</li>
                  )}
                  </ul>
                  <p className="results-note">
                    These values are simulated and for demonstration purposes only. Actual computations would involve complex image processing.
                  </p>
                </div>
              )}
            </div>
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
              noWrap={true}
              keepBuffer={5}
            />
          )}

          {image2Info && (
            <TileLayer
              url={image2Info.tileUrlTemplate} // Use the template from the backend
              bounds={image2Info.bounds}
              opacity={1}
              tms={false}
              zIndex={2}
              noWrap={true}
              keepBuffer={5}
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