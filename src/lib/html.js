import React from 'react';
import htm from 'htm';

// JSX の代わりのタグ付きテンプレート（ビルド不要）
export const html = htm.bind(React.createElement);
export { React };
