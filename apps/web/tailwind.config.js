/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        matte: "#0D0D0D",
        gold: {
          100: "#fff6d2",
          300: "#f4d77d",
          500: "#d8ae43",
          700: "#9f7424"
        }
      },
      backgroundImage: {
        "gold-gradient": "linear-gradient(120deg, #f8e9af 0%, #d8ae43 40%, #8f6520 100%)",
        "luxury-glow": "radial-gradient(circle at top right, rgba(216,174,67,0.28), transparent 55%)"
      },
      boxShadow: {
        luxe: "0 18px 45px rgba(0,0,0,0.35)",
        gold: "0 10px 30px rgba(216,174,67,0.35)"
      },
      fontFamily: {
        heading: ["Cormorant Garamond", "Playfair Display", "serif"],
        body: ["Manrope", "Inter", "Poppins", "sans-serif"]
      },
      keyframes: {
        shine: {
          "0%": { transform: "translateX(-130%)" },
          "100%": { transform: "translateX(130%)" }
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        shine: "shine 1.3s ease-out",
        fadeUp: "fadeUp 0.6s ease-out forwards"
      }
    }
  },
  plugins: [require("@tailwindcss/forms")]
};
