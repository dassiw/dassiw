// Lesson deck. Each new tab shows the next word in this list.
// keywords: used to pull a random, related background photo.
const WORDS = [
  {
    hangul: "불고기", romanization: "bul-go-gi", pos: "noun",
    meaning: "bulgogi (Korean barbecue)",
    sentence_ko: "저는 불고기를 아주 좋아해요.",
    sentence_en: "I really like bulgogi.",
    tip: "Literally 'fire meat': thin beef marinated in soy sauce and sugar, then grilled.",
    keywords: "korean,barbecue,grill"
  },
  {
    hangul: "김치", romanization: "gim-chi", pos: "noun",
    meaning: "kimchi (fermented vegetables)",
    sentence_ko: "저는 매일 김치를 먹어요.",
    sentence_en: "I eat kimchi every day.",
    tip: "The 'ㅈ' sounds between 'j' and 'ch'. Unaspirated, softer than the English 'ch'.",
    keywords: "kimchi,korean,food"
  },
  {
    hangul: "안녕하세요", romanization: "an-nyeong-ha-se-yo", pos: "phrase",
    meaning: "hello",
    sentence_ko: "안녕하세요! 만나서 반가워요.",
    sentence_en: "Hello! Nice to meet you.",
    tip: "The polite greeting. Use it with anyone you don't know well or who is older than you.",
    keywords: "hello,smile,people"
  },
  {
    hangul: "감사합니다", romanization: "gam-sa-ham-ni-da", pos: "phrase",
    meaning: "thank you (formal)",
    sentence_ko: "도와주셔서 감사합니다.",
    sentence_en: "Thank you for helping me.",
    tip: "For a casual 'thanks' with friends, say 고마워요 (go-ma-wo-yo).",
    keywords: "gratitude,flowers,smile"
  },
  {
    hangul: "사랑", romanization: "sa-rang", pos: "noun",
    meaning: "love",
    sentence_ko: "나는 너를 사랑해.",
    sentence_en: "I love you.",
    tip: "This is the casual form. Use 사랑해요 (sa-rang-hae-yo) with people you're polite to.",
    keywords: "love,heart,couple"
  },
  {
    hangul: "친구", romanization: "chin-gu", pos: "noun",
    meaning: "friend",
    sentence_ko: "그는 제 오랜 친구예요.",
    sentence_en: "He is my old friend.",
    tip: "제 (je) means 'my' in a polite way. 저 (jeo) means 'I'.",
    keywords: "friends,laughing,park"
  },
  {
    hangul: "학교", romanization: "hak-gyo", pos: "noun",
    meaning: "school",
    sentence_ko: "저는 아침 여덟 시에 학교에 가요.",
    sentence_en: "I go to school at eight in the morning.",
    tip: "Particle 에 marks the destination: 학교에 가요 = 'I go to school'.",
    keywords: "school,classroom,university"
  },
  {
    hangul: "물", romanization: "mul", pos: "noun",
    meaning: "water",
    sentence_ko: "물 한 잔 주세요.",
    sentence_en: "Please give me a glass of water.",
    tip: "Ask politely with 주세요 (ju-se-yo), 'please give'. Works in any cafe or restaurant.",
    keywords: "water,glass,drink"
  },
  {
    hangul: "커피", romanization: "keo-pi", pos: "noun",
    meaning: "coffee",
    sentence_ko: "저는 아침마다 커피를 마셔요.",
    sentence_en: "I drink coffee every morning.",
    tip: "마셔요 (ma-syeo-yo) is 'drink'. Use it for coffee, water, tea, and most drinks.",
    keywords: "coffee,cafe,latte"
  },
  {
    hangul: "하늘", romanization: "ha-neul", pos: "noun",
    meaning: "sky",
    sentence_ko: "오늘 하늘이 정말 파래요.",
    sentence_en: "The sky is really blue today.",
    tip: "파래요 (pa-rae-yo) is the polite form of 파랗다 (blue). Colours are adjectives in Korean.",
    keywords: "sky,blue,clouds"
  },
  {
    hangul: "바다", romanization: "ba-da", pos: "noun",
    meaning: "sea",
    sentence_ko: "여름에 바다에 가고 싶어요.",
    sentence_en: "I want to go to the sea in summer.",
    tip: "고 싶어요 (go si-peo-yo) means 'want to do'. Attach it to any verb stem.",
    keywords: "sea,ocean,beach"
  },
  {
    hangul: "산", romanization: "san", pos: "noun",
    meaning: "mountain",
    sentence_ko: "주말에 산에 올라가요.",
    sentence_en: "I climb the mountain on weekends.",
    tip: "Korea is famous for hiking. 산 is also part of many place names.",
    keywords: "mountain,hiking,forest"
  },
  {
    hangul: "서울", romanization: "seo-ul", pos: "noun",
    meaning: "Seoul (capital of Korea)",
    sentence_ko: "서울은 아주 큰 도시예요.",
    sentence_en: "Seoul is a very big city.",
    tip: "Notice 은 after 서울: the topic particle attaches to the end of the word.",
    keywords: "seoul,city,skyline"
  },
  {
    hangul: "책", romanization: "chaek", pos: "noun",
    meaning: "book",
    sentence_ko: "이 책은 정말 재미있어요.",
    sentence_en: "This book is really interesting.",
    tip: "이 means 'this'. Put it before the noun: 이 책 = 'this book'.",
    keywords: "books,reading,library"
  },
  {
    hangul: "시간", romanization: "si-gan", pos: "noun",
    meaning: "time",
    sentence_ko: "지금 시간이 없어요.",
    sentence_en: "I don't have time right now.",
    tip: "없어요 (eop-seo-yo) means 'there is not' or 'I don't have'. Its opposite is 있어요.",
    keywords: "clock,time,watch"
  },
  {
    hangul: "행복", romanization: "haeng-bok", pos: "noun",
    meaning: "happiness",
    sentence_ko: "저는 지금 정말 행복해요.",
    sentence_en: "I am really happy right now.",
    tip: "행복하다 is an adjective: 행복해요 (haeng-bo-kae-yo) means 'I am happy'.",
    keywords: "happiness,sunshine,joy"
  },
  {
    hangul: "여행", romanization: "yeo-haeng", pos: "noun",
    meaning: "travel / trip",
    sentence_ko: "다음 달에 여행을 갈 거예요.",
    sentence_en: "I am going on a trip next month.",
    tip: "-ㄹ 거예요 (-l geo-ye-yo) expresses a plan for the future.",
    keywords: "travel,trip,airplane"
  },
  {
    hangul: "비", romanization: "bi", pos: "noun",
    meaning: "rain",
    sentence_ko: "밖에 비가 와요.",
    sentence_en: "It is raining outside.",
    tip: "The verb 오다 (to come) is used for rain falling: 비가 와요 = 'it's raining'.",
    keywords: "rain,rainy,umbrella"
  },
  {
    hangul: "꽃", romanization: "kkot", pos: "noun",
    meaning: "flower",
    sentence_ko: "정원에 꽃이 많아요.",
    sentence_en: "There are many flowers in the garden.",
    tip: "많아요 (ma-na-yo) means 'there are many'. 적어요 (jeo-geo-yo) means 'there are few'.",
    keywords: "flowers,garden,spring"
  },
  {
    hangul: "음악", romanization: "eum-ak", pos: "noun",
    meaning: "music",
    sentence_ko: "저는 음악을 들을 때 기분이 좋아요.",
    sentence_en: "I feel good when I listen to music.",
    tip: "-ㄹ 때 (-l ttae) means 'when'. Attach it to a verb stem: 들을 때 = 'when listening'.",
    keywords: "music,concert,headphones"
  }
];
