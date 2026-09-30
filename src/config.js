// 公開して問題ない値だけ（publishable キーは他の自作アプリと共通。実際の守りはDB側の関数）
export const SUPABASE_URL = 'https://gzayrjlhruhvklsidraw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_-sNQxpwsU7JxhPF9S2vn5A_-CCTqQZL';
export const FN_URL = SUPABASE_URL + '/functions/v1/tabiwari';
// 共有リンクの行き先（ローカルで動かしているときも、友だちには公開版のリンクを渡す）
export const PUBLIC_URL = 'https://neitianguang209-oss.github.io/tabiwari/';
export const APP_VERSION = '1.1.0';
