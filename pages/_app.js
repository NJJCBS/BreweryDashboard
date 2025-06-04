// pages/_app.js
import Head from 'next/head'
import '../styles/globals.css'

function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        {/* 
          If you used a PNG instead of ICO, change to /favicon.png 
          Otherwise leave as /favicon.ico 
        */}
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Component {...pageProps} />
    </>
  )
}

export default MyApp
