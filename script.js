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
	const outsideOutput = /** @type {HTMLOutputElement} */ (document.getElementById('outsideResult'))
	outsideOutput.value = outsideEvaporationRate.toFixed(5)

	const insideOutput = /** @type {HTMLOutputElement} */ (document.getElementById('insideResult'))
	insideOutput.value = insideEvaporationRate.toFixed(5)

	const output = /** @type {HTMLOutputElement} */ (document.getElementById('output'))

	if (insideEvaporationRate === 0 || outsideEvaporationRate === 0) {
		output.value = '🤷'
		return
	}

	const ratio = outsideEvaporationRate / insideEvaporationRate
	const ALLOWED_DELTA = 0.2
	if (ratio > 1 + ALLOWED_DELTA) {
		output.value = `Outside is ${(ratio).toFixed(2)}x better`
	} else if (ratio < 1 - ALLOWED_DELTA) {
		output.value = `Inside is ${(1 / ratio).toFixed(2)}x better`
	} else {
		output.value = 'Both are equally good'
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
	const coords = await getLocation()
	if (!coords) return

	const url = new URL('https://api.open-meteo.com/v1/forecast')
	url.searchParams.set('latitude', coords.latitude.toString())
	url.searchParams.set('longitude', coords.longitude.toString())
	const stats = [
		'temperature_2m',
		'relative_humidity_2m',
		'precipitation',
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

		const temperature = average(data.hourly.temperature_2m, 3) // °C
		const humidity = average(data.hourly.relative_humidity_2m, 3) // %
		const windSpeedKmh = average(data.hourly.wind_speed_10m, 3) // km/h
		const sunshine = average(data.hourly.direct_normal_irradiance, 3) // W/m²

		const windSpeed = windSpeedKmh / 3.6 // m/s

		const fields = getOutsideFields()
		fields.temperature.value = temperature.toFixed(1)
		fields.humidity.value = humidity.toFixed(1)
		fields.windSpeed.value = windSpeed.toFixed(1)
		fields.sunshine.value = sunshine.toFixed(1)

		onOutsideFieldsetChange()
	} catch (e) {
		console.error(new Error('Failed to fetch weather data', { cause: e }))
	}
}

/**
 * @returns {Promise<GeolocationCoordinates|null>}
 */
async function getLocation() {
	if (!navigator.geolocation) {
		alert('Geolocation is not supported by your browser')
		return null
	}

	return new Promise((resolve) => {
		navigator.geolocation.getCurrentPosition(
			({ coords }) => resolve(coords),
			(e) => {
				alert('Unable to retrieve your location')
				console.error(new Error('Geolocation error', { cause: e }))
				resolve(null)
			}
		)
	})
}

/**
 * @param {number[]} values
 * @param {number} length
 * @returns {number} average of the values
 */
function average(values, length) {
	let sum = 0
	const min = Math.min(values.length, length)
	for (let i = 0; i < min; i++) {
		sum += values[i]
	}
	return sum / min
}