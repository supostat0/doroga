// Погода и время суток фиксированы: зимняя ночь, густой снег, город в огнях.
// Игрок это не меняет — так задумано.
export const WEATHER = {
  fogColor: 0x221f33,
  skyTop: 0x0b0d1c,
  fogDensity: 0.018,
  skyLight: 0x4a5078,
  groundLight: 0x2a2836,
  hemiIntensity: 1.1,
  moonIntensity: 0.25,
  snowFlakes: 14000,
  wind: [1.2, 0, 0.6],
};

// Пиксельный рендер: высота картинки в «пикселях» (меньше — крупнее пиксель).
export const PIXEL_HEIGHT = 330;

// Цикл светофоров, секунды. Фаза A — оси вдоль Невского, B — поперечные.
export const SIGNAL_CYCLE = { green: 18, yellow: 3, allRed: 2 };
