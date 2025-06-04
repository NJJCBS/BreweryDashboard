// pages/_app.js
import Head from 'next/head'
import '../styles/globals.css'   // ← this file now exists

function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        {/* If you used favicon.png instead of favicon.ico, change to /favicon.png */}
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Component {...pageProps} />
    </>
  )
}

export default MyApp
