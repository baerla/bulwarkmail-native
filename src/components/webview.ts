import RNWebView from 'react-native-webview';

// react-native-webview 14 declares `class WebView<P = undefined>` with props
// `WebViewProps & P`, and `WebViewProps & undefined` is `never`, so no <WebView>
// type-checks. Fixing P to `object` restores the real props; at runtime this is
// the library's own component.
export const WebView = RNWebView<object>;
export type WebViewHandle = RNWebView<object>;
