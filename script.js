const ASSUMED_INSIDE_WIND_SPEED = 0.2 // m/s
const WIND_EFFECT_FACTOR = 0.5 // ~0.5 - 1.5 empirical factor to account for wind effect on evaporation
const K = 0.00023 // empirical constant to convert to kg/m²/s
const LATENT_HEAT_VAPORIZATION = 2.45e6 // J/kg

const autoFillButton = /** @type {HTMLButtonElement} */ (document.getElementById('fetchWeather'))
autoFillButton.addEventListener('click', autoFillOutsideWeather)

const outsideFieldset = /** @type {HTMLFieldSetElement} */ (document.getElementById('outside'))
const insideFieldset = /** @type {HTMLFieldSetElement} */ (document.getElementById('inside'))

let insideEvaporationRate = 0
let outsideEvaporationRate = 0
let rainProbability = 0

outsideFieldset.addEventListener('input', onOutsideFieldsetChange)
insideFieldset.addEventListener('input', onInsideFieldsetChange)

function onOutsideFieldsetChange() {
	const fields = getOutsideFields()
	const temperature = fields.temperature.value ? parseFloat(fields.temperature.value) : 0
	const humidity = fields.humidity.value ? parseFloat(fields.humidity.value) : 0
	const windSpeed = fields.windSpeed.value ? parseFloat(fields.windSpeed.value) : undefined
	const sunshine = fields.sunshine.value ? parseFloat(fields.sunshine.value) : undefined

	const evaporationRate = computeEvaporationRate({ temperature, humidity, windSpeed, sunshine })
	outsideEvaporationRate = evaporationRate

	updateOutputs()
}

function getOutsideFields() {
	const temperature = /** @type {HTMLInputElement} */ (outsideFieldset.elements.namedItem('outsideTemp'))
	const humidity = /** @type {HTMLInputElement} */ (outsideFieldset.elements.namedItem('outsideHumidity'))
	const windSpeed = /** @type {HTMLInputElement} */ (outsideFieldset.elements.namedItem('outsideWind'))
	const sunshine = /** @type {HTMLInputElement} */ (outsideFieldset.elements.namedItem('outsideSunshine'))
	return { temperature, humidity, windSpeed, sunshine }
}


function onInsideFieldsetChange() {
	const fields = getInsideFields()
	const temperature = fields.temperature.value ? parseFloat(fields.temperature.value) : 0
	const humidity = fields.humidity.value ? parseFloat(fields.humidity.value) : 0

	const evaporationRate = computeEvaporationRate({ temperature, humidity })
	insideEvaporationRate = evaporationRate

	updateOutputs()
}

function getInsideFields() {
	const temperature = /** @type {HTMLInputElement} */ (insideFieldset.elements.namedItem('insideTemp'))
	const humidity = /** @type {HTMLInputElement} */ (insideFieldset.elements.namedItem('insideHumidity'))
	const windSpeed = /** @type {HTMLInputElement} */ (insideFieldset.elements.namedItem('insideWind'))
	return { temperature, humidity, windSpeed }
}

function updateOutputs() {
	const outsideOutput = /** @type {MathMLElement} */ (document.getElementById('outsideResult'))
	outsideOutput.innerHTML = outsideEvaporationRate.toFixed(5)

	const insideOutput = /** @type {MathMLElement} */ (document.getElementById('insideResult'))
	insideOutput.innerHTML = insideEvaporationRate.toFixed(5)

	const output = /** @type {HTMLOutputElement} */ (document.getElementById('output'))

	if (insideEvaporationRate === 0 || outsideEvaporationRate === 0) {
		output.innerHTML = '🤷'
		return
	}

	const ratio = outsideEvaporationRate / insideEvaporationRate
	const ALLOWED_DELTA = 0.2
	if (ratio > 1 + ALLOWED_DELTA) {
		if (rainProbability > 2) {
			output.innerHTML = `🌦️ Outside is ${(ratio).toFixed(2)}x better, but there's a ${Math.round(rainProbability)}% chance of rain`
		} else {
			output.innerHTML = `☀️ Outside is ${(ratio).toFixed(2)}x better`
		}
	} else if (ratio < 1 - ALLOWED_DELTA) {
		output.innerHTML = `🏠 Inside is ${(1 / ratio).toFixed(2)}x better`
	} else {
		output.innerHTML = '🤷 Both are equally good'
	}
}

/**
 * @param {Object} params
 * @param {number} params.temperature in °C
 * @param {number} params.humidity in %
 * @param {number} [params.windSpeed] in m/s
 * @param {number} [params.sunshine] in W/m²
 * @returns {number} evaporation rate in kg/m²/s
 */
function computeEvaporationRate({
	temperature,
	humidity,
	windSpeed = ASSUMED_INSIDE_WIND_SPEED,
	sunshine = 0,
}) {
	const es = saturationVaporPressure(temperature)
	const ea = vaporPressure(temperature, humidity)

	return K * (es - ea) * (1 + WIND_EFFECT_FACTOR * windSpeed) + sunshine / LATENT_HEAT_VAPORIZATION
}

/**
 * @param {Object} params
 * @param {number} params.temperature in °C
 * @returns {number} saturation vapor pressure in kPa
 */
function saturationVaporPressure(temperature) {
	// Tetens formula
	return 0.61078 * Math.exp((17.27 * temperature) / (temperature + 237.3))
}

/**
 * @param {number} temperature in °C
 * @param {number} humidity in %
 * @returns {number} vapor pressure in kPa
 */
function vaporPressure(temperature, humidity) {
	return (humidity / 100) * saturationVaporPressure(temperature)
}

async function autoFillOutsideWeather() {
	rainProbability = 0
	const fetchStateOutput = /** @type {HTMLOutputElement} */ (document.getElementById('fetchState'))
	if (fetchStateOutput) fetchStateOutput.value = '⏳'

	const coords = await getLocation()
	if (!coords) {
		if (fetchStateOutput) fetchStateOutput.value = '❌'
		return
	}

	reverseGeocode(coords).then(address => {
		const addressOutput = /** @type {HTMLOutputElement} */ (document.getElementById('address'))
		if (addressOutput) addressOutput.value = address ?? ''
	})

	const data = await getWeatherData(coords)
	if (!data) {
		if (fetchStateOutput) fetchStateOutput.value = '❌'
		return
	}

	try {
		const hour = new Date().getHours()
		const temperature = average(data.hourly.temperature_2m, hour, 3) // °C
		const humidity = average(data.hourly.relative_humidity_2m, hour, 3) // %
		const windSpeedKmh = average(data.hourly.wind_speed_10m, hour, 3) // km/h
		const sunshine = average(data.hourly.direct_normal_irradiance, hour, 3) // W/m²
		const rain = average(data.hourly.precipitation_probability, hour, 3) // %

		const windSpeed = windSpeedKmh / 3.6 // m/s

		rainProbability = rain

		const fields = getOutsideFields()
		fields.temperature.value = temperature.toFixed(1)
		fields.humidity.value = humidity.toFixed(1)
		fields.windSpeed.value = windSpeed.toFixed(1)
		fields.sunshine.value = sunshine.toFixed(1)
	} catch (e) {
		alert('Failed to parse weather data')
		console.error(new Error('Failed to parse weather data', { cause: e }))
		if (fetchStateOutput) fetchStateOutput.value = '❌'
		return
	}

	if (fetchStateOutput) fetchStateOutput.value = '✅'
	onOutsideFieldsetChange()
}

/**
 * @param {GeolocationCoordinates} coords
 * @returns {Promise<string | null>} address
 */
function reverseGeocode(coords) {
	const url = new URL('https://nominatim.openstreetmap.org/reverse')
	url.searchParams.set('lat', coords.latitude.toString())
	url.searchParams.set('lon', coords.longitude.toString())
	url.searchParams.set('format', 'json')

	return fetch(url)
		.then(response => response.json())
		.then(data => data.display_name)
		.catch(() => null)
}

if (navigator.permissions) {
	navigator.permissions.query({ name: "geolocation" }).then(r => {
		if (r.state === 'granted') {
			autoFillOutsideWeather()
		}
	})
}

/**
 * @param {GeolocationCoordinates} coords
 */
async function getWeatherData(coords) {
	const url = new URL('https://api.open-meteo.com/v1/forecast')
	url.searchParams.set('latitude', coords.latitude.toString())
	url.searchParams.set('longitude', coords.longitude.toString())
	const stats = [
		'temperature_2m',
		'relative_humidity_2m',
		// 'precipitation',
		'wind_speed_10m',
		'precipitation_probability',
		'direct_normal_irradiance',
		// 'global_tilted_irradiance',
	]
	url.searchParams.set('hourly', stats.join(','))
	url.searchParams.set('current', 'relative_humidity_2m')
	url.searchParams.set('forecast_days', '1')
	url.searchParams.set('timezone', 'auto')

	try {
		const response = await fetch(url)
		const data = await response.json()
		return data
	} catch (e) {
		alert('Failed to fetch weather data')
		console.error(new Error('Failed to fetch weather data', { cause: e }))
		return null
	}
}

/**
 * @returns {Promise<GeolocationCoordinates|null>}
 */
async function getLocation() {
	const coordinatesOutput = /** @type {HTMLOutputElement} */ (document.getElementById('coordinates'))
	if (!navigator.geolocation) {
		alert('Geolocation is not supported by your browser')
		if (coordinatesOutput) coordinatesOutput.value = ''
		return null
	}

	return new Promise((resolve) => {
		navigator.geolocation.getCurrentPosition(
			({ coords }) => {
				if (coordinatesOutput) coordinatesOutput.value = `lat: ${formatCoord(coords.latitude)}, long: ${formatCoord(coords.longitude)}`
				resolve(coords)
			},
			(e) => {
				if (coordinatesOutput) coordinatesOutput.value = ''
				alert('Unable to retrieve your location')
				console.error(new Error('Geolocation error', { cause: e }))
				resolve(null)
			}
		)
	})
}

/**
 * @param {number[]} values
 * @param {number} from
 * @param {number} length
 * @returns {number} average of the values
 */
function average(values, from, length) {
	let sum = 0
	let count = 0
	const min = Math.min(values.length, from + length)
	for (let i = from; i < min; i++) {
		count++
		sum += values[i]
	}
	return sum / count
}

/**
 * @param {number} coord
 */
function formatCoord(coord) {
	const deg = Math.floor(coord)
	const minFloat = Math.abs((coord - deg) * 60)
	const min = Math.floor(minFloat)
	const sec = Math.floor((minFloat - min) * 60)
	return `${deg}°${min}'${sec}"`
}