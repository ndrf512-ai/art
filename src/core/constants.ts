/** Игровых секунд в одной реальной секунде при обычной скорости. */
export const TIME_SCALE = 30;
/** Игровых минут в одной реальной секунде. */
export const GMIN_PER_SEC = TIME_SCALE / 60;

export const MAP_W = 150;
export const MAP_H = 130;
/** Линия фасада бункера: клетки с z < FACADE_Z — массив холма. */
export const FACADE_Z = 59;
export const FACADE_H = 7.4;

/** Начало кампании: 16 октября 1944 г., 05:40. */
export const START_MINUTE = 5 * 60 + 40;
export const START_DAY_OF_MONTH = 16;

export const WALK_SPEED = 1.45;
export const RUN_SPEED = 3.7;

/** Обычный шаг человека — около 1,6 м/с, бег — 4,5 м/с. */
export const PLAYER_WALK = 1.65;
export const PLAYER_RUN = 4.5;
/** Длина шага при ходьбе и при беге, м. */
export const STEP_WALK = 0.74;
export const STEP_RUN = 1.25;
export const PLAYER_RADIUS = 0.32;
export const EYE_HEIGHT = 1.7;

export const SAVE_VERSION = 3;
export const SAVE_PREFIX = 'granit.save.';

/** Карта района, м. */
export const REGION_SIZE = 30000;
export const COMPLEX_POS = { x: 15200, y: 26800 };

export const CLEARANCE_NAMES = ['нет', 'общий', 'служебный', 'штабной', 'особой важности'] as const;

export const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;
