// pages/_app.js
import Head from 'next/head'
import '../styles/globals.css'

function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        {/* Standard favicon link */}
        <link rel="icon" href="/favicon.ico" type="image/x-icon" />

        {/* “Shortcut icon” for older browsers and some caching situations */}
        <link rel="shortcut icon" href="/favicon.ico" type="image/x-icon" />

        {/* (Optional) If you ever switch to PNG, you can use:
          <link rel="icon" href="/favicon.png" type="image/png" />
          <link rel="shortcut icon" href="/favicon.png" type="image/png" />
        */}
      </Head>
      <Component {...pageProps} />
    </>
  )
}

export default MyApp
