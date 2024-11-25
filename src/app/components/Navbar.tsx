'use client'

import React from 'react'
import Link from 'next/link'

const Navbar: React.FC = () => {
  return (
    <nav className="absolute top-0 right-0 z-50 p-6">
      <Link 
        href="/dashboard" 
        className="text-white/80 hover:text-white transition-colors"
      >
        Dashboard →
      </Link>
    </nav>
  )
}

export default Navbar 