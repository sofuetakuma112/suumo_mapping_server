// 半角空白があるか
export const hasSpaces = (str) => {
  return str.includes(" ");
};

// 全角空白があるか
export const hasTwoCharSpaces = (str) => {
  return str.includes("　");
};

export const countSpaces = (text) => {
  let howManySpaces = 0;
  for (let i = 0; i < text.length; i++) {
    // 半角空白または全角空白があったときの処理
    if (hasSpaces(text[i]) || hasTwoCharSpaces(text[i])) {
      howManySpaces++;
    }
  }
  return howManySpaces;
};