/**
 * Feishu (Lark) Message Reaction Emojis Configuration
 * Source: https://open.feishu.cn/document/server-docs/im-v1/message-reaction/emojis-introduce
 */

export type FeishuEmojiType =
  | 'OK'
  | 'THUMBSUP'
  | 'THANKS'
  | 'MUSCLE'
  | 'FINGERHEART'
  | 'APPLAUSE'
  | 'FISTBUMP'
  | 'JIAYI'
  | 'DONE'
  | 'SMILE'
  | 'BLUSH'
  | 'LAUGH'
  | 'SMIRK'
  | 'LOL'
  | 'FACEPALM'
  | 'LOVE'
  | 'WINK'
  | 'PROUD'
  | 'WITTY'
  | 'SMART'
  | 'SCOWL'
  | 'THINKING'
  | 'SOB'
  | 'CRY'
  | 'ERROR'
  | 'NOSEPICK'
  | 'HAUGHTY'
  | 'SLAP'
  | 'SPITBLOOD'
  | 'TOASTED'
  | 'GLANCE'
  | 'DULL'
  | 'INNOCENTSMILE'
  | 'JOYFUL'
  | 'WOW'
  | 'TRICK'
  | 'YEAH'
  | 'ENOUGH'
  | 'TEARS'
  | 'EMBARRASSED'
  | 'KISS'
  | 'SMOOCH'
  | 'DROOL'
  | 'OBSESSED'
  | 'MONEY'
  | 'TEASE'
  | 'SHOWOFF'
  | 'COMFORT'
  | 'CLAP'
  | 'PRAISE'
  | 'STRIVE'
  | 'XBLUSH'
  | 'SILENT'
  | 'WAVE'
  | 'WHAT'
  | 'FROWN'
  | 'SHY'
  | 'DIZZY'
  | 'LOOKDOWN'
  | 'CHUCKLE'
  | 'WAIL'
  | 'CRAZY'
  | 'WHIMPER'
  | 'HUG'
  | 'BLUBBER'
  | 'WRONGED'
  | 'HUSKY'
  | 'SHHH'
  | 'SMUG'
  | 'ANGRY'
  | 'HAMMER'
  | 'SHOCKED'
  | 'TERROR'
  | 'PETRIFIED'
  | 'SKULL'
  | 'SWEAT'
  | 'SPEECHLESS'
  | 'SLEEP'
  | 'DROWSY'
  | 'YAWN'
  | 'SICK'
  | 'PUKE'
  | 'BETRAYED'
  | 'HEADSET'
  | 'EatingFood'
  | 'MeMeMe'
  | 'Sigh'
  | 'Typing'
  | 'Lemon'
  | 'Get'
  | 'LGTM'
  | 'OnIt'
  | 'OneSecond'
  | 'VRHeadset'
  | 'YouAreTheBest'
  | 'SALUTE'
  | 'SHAKE'
  | 'HIGHFIVE'
  | 'UPPERLEFT'
  | 'ThumbsDown'
  | 'SLIGHT'
  | 'TONGUE'
  | 'EYESCLOSED'
  | 'RoarForYou'
  | 'CALF'
  | 'BEAR'
  | 'BULL'
  | 'RAINBOWPUKE'
  | 'ROSE'
  | 'HEART'
  | 'PARTY'
  | 'LIPS'
  | 'BEER'
  | 'CAKE'
  | 'GIFT'
  | 'CUCUMBER'
  | 'Drumstick'
  | 'Pepper'
  | 'CANDIEDHAWS'
  | 'BubbleTea'
  | 'Coffee'
  | 'Yes'
  | 'No'
  | 'OKR'
  | 'CheckMark'
  | 'CrossMark'
  | 'MinusOne'
  | 'Hundred'
  | 'AWESOMEN'
  | 'Pin'
  | 'Alarm'
  | 'Loudspeaker'
  | 'Trophy'
  | 'Fire'
  | 'BOMB'
  | 'Music'
  | 'XmasTree'
  | 'Snowman'
  | 'XmasHat'
  | 'FIREWORKS'
  | '2022'
  | 'REDPACKET'
  | 'FORTUNE'
  | 'LUCK'
  | 'FIRECRACKER'
  | 'StickyRiceBalls'
  | 'HEARTBROKEN'
  | 'POOP'
  | 'StatusFlashOfInspiration'
  | '18X'
  | 'CLEAVER'
  | 'Soccer'
  | 'Basketball'
  | 'GeneralDoNotDisturb'
  | 'Status_PrivateMessage'
  | 'GeneralInMeetingBusy'
  | 'StatusReading'
  | 'StatusInFlight'
  | 'GeneralBusinessTrip'
  | 'GeneralWorkFromHome'
  | 'StatusEnjoyLife'
  | 'GeneralTravellingCar'
  | 'StatusBus'
  | 'GeneralSun'
  | 'GeneralMoonRest'
  | 'MoonRabbit'
  | 'Mooncake'
  | 'JubilantRabbit'
  | 'TV'
  | 'Movie'
  | 'Pumpkin'
  | 'BeamingFace'
  | 'Delighted'
  | 'ColdSweat'
  | 'FullMoonFace'
  | 'Partying'
  | 'GoGoGo'
  | 'ThanksFace'
  | 'SaluteFace'
  | 'Shrug'
  | 'ClownFace'
  | 'HappyDragon';

/**
 * Emoji categories for different scenarios
 */
export const FeishuEmojiScenarios = {
  /** Received and processing - default for incoming messages */
  RECEIVED: ['Get', 'OK', 'THUMBSUP'] as FeishuEmojiType[],

  /** Success/Completion */
  SUCCESS: [
    'DONE',
    'CheckMark',
    'LGTM',
    'APPLAUSE',
    'CLAP',
    'PRAISE',
    'AWESOMEN',
  ] as FeishuEmojiType[],

  /** Error/Failure */
  ERROR: [
    'ERROR',
    'CrossMark',
    'FACEPALM',
    'SPITBLOOD',
    'CRY',
  ] as FeishuEmojiType[],

  /** Thinking/Processing */
  THINKING: ['THINKING', 'Typing', 'OneSecond', 'OnIt'] as FeishuEmojiType[],

  /** Agreement/Yes */
  AGREE: ['OK', 'THUMBSUP', 'Yes', 'FISTBUMP', 'HIGHFIVE'] as FeishuEmojiType[],

  /** Disagreement/No */
  DISAGREE: ['ThumbsDown', 'No', 'CrossMark', 'MinusOne'] as FeishuEmojiType[],

  /** Gratitude */
  THANKS: [
    'THANKS',
    'FINGERHEART',
    'LOVE',
    'HEART',
    'ROSE',
  ] as FeishuEmojiType[],

  /** Encouragement */
  ENCOURAGE: [
    'MUSCLE',
    'FIGHTON',
    'STRIVE',
    'YouAreTheBest',
    'GoGoGo',
    'JIAYI',
  ] as FeishuEmojiType[],

  /** Surprise */
  SURPRISE: ['WOW', 'SHOCKED', 'WOW', 'TERROR'] as FeishuEmojiType[],

  /** Confusion */
  CONFUSION: [
    'WHAT',
    'THINKING',
    'FACEPALM',
    'DIZZY',
    'SHRUG',
  ] as FeishuEmojiType[],

  /** Celebration */
  CELEBRATE: [
    'PARTY',
    'FIREWORKS',
    'Trophy',
    'FIRE',
    'Champagne',
  ] as FeishuEmojiType[],

  /** Working on it */
  WORKING: [
    'OnIt',
    'Typing',
    'MUSCLE',
    'STRIVE',
    'HEADSET',
  ] as FeishuEmojiType[],

  /** Urgent/Important */
  URGENT: ['Alarm', 'Loudspeaker', 'Fire', 'BOMB', 'Pin'] as FeishuEmojiType[],

  /** Funny/Humor */
  FUNNY: [
    'LOL',
    'LAUGH',
    'SMIRK',
    'WITTY',
    'TRICK',
    'ClownFace',
  ] as FeishuEmojiType[],

  /** Sadness */
  SAD: ['SOB', 'CRY', 'TEARS', 'HEARTBROKEN', 'Sigh'] as FeishuEmojiType[],

  /** Greeting */
  GREETING: ['WAVE', 'SALUTE', 'SMILE', 'HI'] as FeishuEmojiType[],

  /** Busy */
  BUSY: [
    'GeneralInMeetingBusy',
    'GeneralDoNotDisturb',
    'StatusReading',
    'Typing',
  ] as FeishuEmojiType[],
} as const;

/**
 * Keywords to emoji scenario mapping
 * Used for automatic emoji selection based on message content
 */
export const EmojiKeywordMap: Record<string, FeishuEmojiType[]> = {
  // Success/Completion
  完成: FeishuEmojiScenarios.SUCCESS,
  好了: FeishuEmojiScenarios.SUCCESS,
  搞定: FeishuEmojiScenarios.SUCCESS,
  success: FeishuEmojiScenarios.SUCCESS,
  done: FeishuEmojiScenarios.SUCCESS,
  ok: FeishuEmojiScenarios.AGREE,
  好的: FeishuEmojiScenarios.AGREE,

  // Error/Failure
  错误: FeishuEmojiScenarios.ERROR,
  失败: FeishuEmojiScenarios.ERROR,
  error: FeishuEmojiScenarios.ERROR,
  fail: FeishuEmojiScenarios.ERROR,
  抱歉: FeishuEmojiScenarios.SAD,
  对不起: FeishuEmojiScenarios.SAD,

  // Thinking
  思考: FeishuEmojiScenarios.THINKING,
  考虑: FeishuEmojiScenarios.THINKING,
  think: FeishuEmojiScenarios.THINKING,
  等等: FeishuEmojiScenarios.WORKING,
  稍等: FeishuEmojiScenarios.WORKING,
  处理中: FeishuEmojiScenarios.WORKING,

  // Thanks
  谢谢: FeishuEmojiScenarios.THANKS,
  感谢: FeishuEmojiScenarios.THANKS,
  thx: FeishuEmojiScenarios.THANKS,
  thanks: FeishuEmojiScenarios.THANKS,

  // Encourage
  加油: FeishuEmojiScenarios.ENCOURAGE,
  努力: FeishuEmojiScenarios.ENCOURAGE,
  你可以: FeishuEmojiScenarios.ENCOURAGE,

  // Surprise
  惊讶: FeishuEmojiScenarios.SURPRISE,
  震惊: FeishuEmojiScenarios.SURPRISE,
  wow: FeishuEmojiScenarios.SURPRISE,
  amazing: FeishuEmojiScenarios.SURPRISE,

  // Funny
  哈哈: FeishuEmojiScenarios.FUNNY,
  呵呵: FeishuEmojiScenarios.FUNNY,
  搞笑: FeishuEmojiScenarios.FUNNY,
  haha: FeishuEmojiScenarios.FUNNY,
  lol: FeishuEmojiScenarios.FUNNY,

  // Urgent
  紧急: FeishuEmojiScenarios.URGENT,
  ' hurry': FeishuEmojiScenarios.URGENT,
  urgent: FeishuEmojiScenarios.URGENT,
  asap: FeishuEmojiScenarios.URGENT,
};

/**
 * Select an appropriate emoji based on message content
 * Returns a random emoji from the matching scenario, or default to RECEIVED
 */
export function selectEmojiForMessage(content: string): FeishuEmojiType {
  const lowerContent = content.toLowerCase();

  // Check for keyword matches
  for (const [keyword, emojis] of Object.entries(EmojiKeywordMap)) {
    if (lowerContent.includes(keyword.toLowerCase())) {
      return emojis[Math.floor(Math.random() * emojis.length)];
    }
  }

  // Default: RECEIVED scenario
  const defaults = FeishuEmojiScenarios.RECEIVED;
  return defaults[Math.floor(Math.random() * defaults.length)];
}

/**
 * Get emoji by scenario name
 */
export function getEmojiByScenario(
  scenario: keyof typeof FeishuEmojiScenarios,
): FeishuEmojiType {
  const emojis = FeishuEmojiScenarios[scenario];
  return emojis[Math.floor(Math.random() * emojis.length)];
}
