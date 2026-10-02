/**
 * Captures of Gemini's visible sparkle over black, as calibrated by the two
 * projects that measured them. Each is the unchanged PNG, base64-encoded; the
 * SHA-256 below is the file's, and masks.test.ts checks it. Brightness over
 * black is the logo's opacity: alpha = value / 255 (the brightest channel).
 *
 * v1-48, v1-96  the 48 and 96 px logo, measured by AllenK (Kwyshell); at about
 *               0.6 of its opacity the 48 px capture also matches the fainter
 *               48 px logo set 96 px in
 * v2-96         the paler 96 px logo, captured in May 2026 by Jad (GargantuaX)
 * v2-36         the small 36 px logo, measured by AllenK (Kwyshell)
 *
 * MIT licensed: (c) 2024 AllenK (Kwyshell), github.com/allenk/GeminiWatermarkTool;
 * (c) 2025 Jad, github.com/GargantuaX/gemini-watermark-remover. Full notices in
 * public/third-party/gemini-watermark-masks.txt. Only these data files come from
 * those projects; the detection and removal code here is PrivaTools' own.
 */
export type MaskId = "v1-48" | "v1-96" | "v2-96" | "v2-36";

export interface MaskSource {
    /** Width and height in pixels; every capture is square. */
    size: number;
    sha256: string;
    origin: string;
    /** The PNG file, base64. */
    png: string;
}

export const MASK_SOURCES: Record<MaskId, MaskSource> = {
    "v1-48": {
        size: 48,
        sha256: "4afc99afe0ef108d67acc45bf4dc5da867ddb793bebc89c9243bb121ce7f0f57",
        origin: "bg_48.png: src/assets/bg_48.png in GargantuaX/gemini-watermark-remover at 1319561, byte-identical to bg_48_png in allenk/GeminiWatermarkTool assets/embedded_assets.hpp at 7c6a99f",
        png:
            "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAGVElEQVR4nMVYvXIbNxD+FvKMWInXmd2dK7MTO7sj9QKWS7qy/Ab2" +
            "o/gNmCp0JyZ9dHaldJcqTHfnSSF1R7kwlYmwKRYA93BHmkrseMcjgzgA++HbH2BBxhhmBiB/RYgo+hkGSFv/ZOY3b94w89u3b6HE" +
            "L8JEYCYATCAi2JYiQ8xMDADGWsvMbfVagm6ZLxKGPXr0qN/vJ0mSpqn0RzuU//Wu9MoyPqxmtqmXJYwxxpiAQzBF4x8/fiyN4XDY" +
            "oZLA5LfEhtg0+glMIGZY6wABMMbs4CaiR8brkYIDwGg00uuEMUTQ1MYqPBRRYZjZ+q42nxEsaYiV5VOapkmSSLvX62VZprUyM0Di" +
            "QACIGLCAESIAEINAAAEOcQdD4a+2FJqmhDd/YEVkMpmEtrU2igCocNHW13swRBQYcl0enxbHpzEhKo0xSZJEgLIsC4Q5HJaJ2Qg7" +
            "kKBjwMJyCDciBBcw7fjSO4tQapdi5vF43IZ+cnISdh9Y0At2RoZWFNtLsxr8N6CUTgCaHq3g+Pg4TVO1FACSaDLmgMhYC8sEQzCu" +
            "3/mQjNEMSTvoDs4b+nXny5cvo4lBJpNJmKj9z81VrtNhikCgTsRRfAklmurxeKx9JZIsy548eeITKJgAQwzXJlhDTAwDgrXkxxCD" +
            "2GfqgEPa4rnBOlApFUC/39fR1CmTyWQwGAQrR8TonMRNjjYpTmPSmUnC8ODgQHqSJDk7O9uNBkCv15tOp4eHh8SQgBICiCGu49Yn" +
            "SUJOiLGJcG2ydmdwnRcvXuwwlpYkSabTaZS1vyimc7R2Se16z58/f/jw4Z5LA8iy7NmzZ8J76CQ25F2UGsEAJjxo5194q0fn9unp" +
            "6fHx8f5oRCQ1nJ+fbxtA3HAjAmCMCaGuAQWgh4eH0+k0y7LGvPiU3CVXV1fz+by+WQkCJYaImKzL6SEN6uMpjBVMg8FgOp3GfnNP" +
            "QADqup79MLv59AlWn75E/vAlf20ibmWg0Pn06dPJZNLr9e6nfLu8//Ahv/gFAEdcWEsgZnYpR3uM9KRpOplMGmb6SlLX9Ww2q29W" +
            "yjH8+SI+pD0GQJIkJycn/8J/I4mWjaQoijzPb25uJJsjmAwqprIsG4/HbVZ2L/1fpCiKoijKqgTRBlCWZcPhcDQafUVfuZfUdb1c" +
            "LpfL5cePf9Lr16/3zLz/g9T1quNy+F2FiYjSNB0Oh8Ph8HtRtV6vi6JYLpdVVbmb8t3dnSAbjUbRNfmbSlmWeZ6XHytEUQafEo0x" +
            "R0dHUdjvG2X3Sd/Fb0We56t6BX8l2mTq6BCVnqOjo7Ozs29hRGGlqqrOr40CIKqeiGg8Hn/xcri/rG/XeZ7/evnrjjGbC3V05YC/" +
            "BSRJ8urVq36/3zX7Hjaq63o+n19fX/upUqe5VxFok7UBtQ+T6XQ6GAz2Vd6Ssizn8/nt7a3ay1ZAYbMN520XkKenpx0B2E2SLOo+" +
            "FEWxWPwMgMnC3/adejZMYLLS42r7oH4LGodpsVgURdHQuIcURbFYLDYlVKg9sCk5wpWNiHym9pUAEQGG6EAqSxhilRQWi0VZVmrz" +
            "23yI5cPV1dX5TwsmWGYrb2TW36OJGjdXhryKxEeHvjR2Fgzz+bu6XnVgaHEmXhytEK0W1aUADJPjAL6CtPZv5rsGSvUKtv7r8/zd" +
            "j+v1uoOUpsxms7qunT6+g1/TvTQCxE6XR2kBqxjyZo6K66gsAXB1fZ3neQdJSvI8X61WpNaMWCFuKNrkGuGGmMm95fhpvPkn/f6l" +
            "AgAuLy/LstyGpq7r9+8d4rAr443qaln/ehHt1siv3dvt2B/RDpJms5lGE62gEy9az0XGcQCK3DL4DTPr0pPZEjPAZVlusoCSoihW" +
            "qzpCHy7ODRXhbUTJly9oDr4fKDaV9NZJUrszPOjsI0a/FzfwNt4eHH+BSyICqK7rqqo0u0VRrFYridyN87L3pBYf7qvq3wqc3DMl" +
            "dJmiK06pgi8uLqQjAAorRG+p+zLUxks+z7rOkOzlIUy8yrAcQFVV3a4/ywBPmJsVMcTM3l/h9xDlLga4I1PDGaD7UNBPuCKBleUf" +
            "y2gd+DOrPWubGHJJyD+L+LCTjEXEgH//2uSxhu1/Xzocy+VSL+2cUhrqLVZ/jTYL0IMtQEklT3/iWCutzUljDDNXVSVHRFWW7SOt" +
            "ccHag6V/AF1/slVRyOkZAAAAAElFTkSuQmCC",
    },
    "v1-96": {
        size: 96,
        sha256: "3e26f2233a12a5829acac174d8df1f3db40e07fef04ecdd0e035732154077911",
        origin: "bg_96.png: src/assets/bg_96.png in GargantuaX/gemini-watermark-remover at 1319561, byte-identical to bg_96_png in allenk/GeminiWatermarkTool assets/embedded_assets.hpp at 7c6a99f",
        png:
            "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAfrElEQVR4nJV9zXNc15Xf75zXIuBUjG45M7GyEahFTMhVMUEvhmQq" +
            "GYJeRPTG1mokbUL5v5rsaM/CkjdDr4b2RqCnKga9iIHJwqCyMCgvbG/ibparBGjwzpnF+bjnvm7Q9isU2Hj93r3nno/f+bgfJOaZ" +
            "qg4EJfglSkSXMtLAKkRETKqqRMM4jmC1Z5hZVZEXEylUiYgAISKBf8sgiKoqDayqIkJEKBeRArh9++7BwcHn558/+8XRz//30cDD" +
            "OI7WCxGBCYCIZL9EpKoKEKCqzFzpr09aCzZAb628DjAAggBin5UEBCPfuxcRiIpIG2+On8TuZ9Ot9eg+Pxt9+TkIIDBZL9lU/yLv" +
            "7Czeeeedra2txWLxzv948KXtL9WxGWuS1HzRvlKAFDpKtm8yGMfRPmc7diVtRcA+8GEYGqMBEDEgIpcABKqkSiIMgYoIKQjCIACq" +
            "ojpmQ+v8IrUuRyVJ9pk2qY7Gpon0AIAAJoG+8Z/eaGQp9vb2UloCFRWI6igQJQWEmGbeCBGI7DMpjFpmBhPPBh/zbAATRCEKZSgn" +
            "2UzEpGyM1iZCKEhBopzq54IiqGqaWw5VtXAkBl9V3dlUpG2iMD7Yncpcex7eIO/tfb3IDbu7u9kaFTv2Xpi1kMUAmJi5ERDWnZpr" +
            "Jm/jomCohjJOlAsFATjJVcIwzFgZzNmKqIg29VNVIiW2RkLD1fGo2hoRQYhBAInAmBW/Z0SD9y9KCmJ9663dVB8o3n77bSJ7HUQ0" +
            "8EBEzMxGFyuxjyqErwLDt1FDpUzfBU6n2w6JYnRlrCCljpXMDFUEv9jZFhDoRAYo8jDwMBiVYcwAYI0Y7xuOAvW3KS0zM7NB5jAM" +
            "wdPR/jSx77755ny+qGqytbV1/fr11Oscnph+a1PDqphErjnGqqp0eYfKlc1mIz4WdStxDWJms8+0IITdyeWoY2sXgHFalQBiEClc" +
            "tswOBETqPlEASXAdxzGG5L7JsA/A/q1bQDEkAoAbN27kDbN6/1FVHSFjNyS3LKLmW1nVbd9NHsRwxBCoYaKqmpyUREl65IYzKDma" +
            "Vo1iO0aEccHeGUdXnIo4CB+cdpfmrfHA5eVlEXvzdNd3dxtF4V/39/cFKujIJSIaWMmdReqFjGO2ZpaCUGRXc1COvIIOhbNL3acC" +
            "QDb2Es5YtIIBI3SUgZw7Ah1VBKpQmH0RlCAQ81noVd16UnKMpOBa93twRbvx9t5ivnC1MQ4Rwaxsd7eyu36wUQzkxDMxmd9Rl6ux" +
            "yaU+du6/sEBERkMrUmSgY97DyGN7pwlc4UqUuq1q0Cgi6LlrHtY0yNQnv5qMZ/23iHexf/OmhXr5ajZycHC/oklqsT1BAYK1lxy/" +
            "RtCUNphW0uDCZUdJP3UBCgAwmEYVoiEBmyBEauFJ0w4JnGdWSvCHJHK5TimY3BW5hUqNnoxpNkYiWuzM927sdWakjUfXd3cX83mM" +
            "zBVcRaAGgo0wOA5YvGZdiMjo5sZEA4NLMK2SKAZpumZDViWMgBjgFoHXq0p7YpberAgA5iC0iMgF7r4fKX/nZDSmqvfu3attrne0" +
            "f+tWCsmxdhhSlao/yp5SkZkpoj6dtN/rshANptFVfZgtsHAJSKYmREqkDNWxSYM5GjWvpIAoGIJIgkR1lPBrEQCqQiwzM91G+ACG" +
            "YLHz+q39W5UlTkC5c/f2nWvXrjnQBLKk3WlkdqRQESIGKPwdjxp4Fw4XmaVYKKUQqKE+GEqw4COIIZHwYqkpqtpsLeJOs50ItFpg" +
            "YoJJL1Dl74lEoobLChbqARiGYX9/XzHV3OzU/tza2rp7925VE44rlcJlTi2VqcplXWeQMfVTmg63Cak+UIIXVQXzbHAzjywnHhsQ" +
            "TtSkoapE3GJiu6Tpp/VYs1PjkcHBl+c7+/v7BKoaQ2SOCCDNb27fuX1t65qJmgYWBIIw0eDphRJM8lr426ROMABSQs3FwAB5EDMM" +
            "M+ZZlXc+gprFQDnMm2salYFGdQEosU+2aFmuMdX+ybdM8kb3/YP788WihUONJiViTVgnbG9/6c7du0Q0ljCKIoJvFBY3VEU2USuQ" +
            "ELdMkJhNhKZiGmlTY5CZTyZyImLGLlBNpRUikKmRB2/mHUM7Mj50iYWXcUMI6YmKBX47Ozs3b36jKg4oYgKFNUupWap3bt+Z7+xY" +
            "DigiSiygcRyppNkM0lHM1ZICMjJUVCz4NtlbVcfZqgohHaEQwUgtlyoYJ9KKT6lKIpLp/LpbMV3wBKIm0OKZoaq/raOM/3qJgkQU" +
            "Ej44OLCRh4ynvjLU2f/c3tp68OBBakcx2FYkMDmJiNmIB3PULjT1j7ciQKnxXQ2UeBgYUHMzAEQvFSNYlYQwQFrEGVA1dE2IQERM" +
            "AgMEYjCRDzPPKmX2+e0be/vfuBkKktgIoqaGwbMmmL29vTff3I1xewUqC0Cq5nOK6TFqrquqyqoOUi11hPnZsUV8FLHiQAxRRoG0" +
            "asNExMNg+XdVv57TbQAWR4hLz6Dh0kJEVU0LB/BO6MJEObuakY2td3Hvfvfd7e1t6omMyAUAtBaOyxUm1hHfY5NbwBClC2Sg51qm" +
            "YJANzx2JjtAxogZk7uspj3PNQx6DYCJmmmkEqESkKqZlKfaDeweL+VxrvFwGktwBoAnU4c4W88X9gwNS8TqBR+3+UGW4KQcR7GGy" +
            "orcIhyKnETAzgxkDqZKKoZiqZNbUkm/K8K5wfRIUVAiotfcUiKpSqwB6Vqnq6PPVr3713r17zfLXL+rvR9ICdSC/ffvO7u51J52b" +
            "+mdklLDNnNoRH/q6lUZoHmQjm2UmzUpGhElehIZ0fHE8F4XoQDOGFRXJ80e28iKrEmGQEYl/RMqzGZhFHC/mX955/72/s8jMR7+R" +
            "R21U8bV9DA159913t7f/HdEAZVI2s4o40Avno14Gs9j9aY1CGth7nsjMEX+LYIQQKUcVqahAKkhyN0EhYajoUfMpLWpwf+/Ba7mD" +
            "g4OD+c7CzCgUr5MwjCkGF9IqCl0pjTBfLL77ne8YiQ0uu8C6hdfVRWRMv24Wlo4F9Gg+Q0RliqMRMdjT1fWYfKxCmDcBj1kAWADm" +
            "wAYmZfMCYFXC3x7cu7l/s3aSvxQgTutWr5umi4sPYWoAsHdj787f3CZS1bFiykAzCBGxjKo0jIFKqqPIZdR61GZZmBkggM39JdYy" +
            "D9mmiLAqVDDhKFFXh88Xwr6iqoQWQVRWpg4CgOj169cP7h1URdCsKJKDVGOcexxMwoCJur3zzjtvvvlmEWpTZx3B/BplfBQSjVG0" +
            "cC+RyzNEbSqGzPtIiSnQziom7AVgcJ+2mYoSaPAqTxbx3PGJVtS3Mtt8/vr7f/felWijUFFMHFpGiRWzC2Db9f7777/++rwW5y/F" +
            "FEqho1uHKBMDnGhrHj39jE8ujqqqIMdsq4VZENfGU6UBQGS0e7XMXJ9J866/VTNphkB3dnYePny4tbVV360aMf1btUEzrX3f5+vb" +
            "29sPH364mM9TZw1rndpWq3HK1wsAOQoeuijRO7Q2lUSQDlut7mPqbNZYp5KJyGZfqjVx5Htl1ghgnr8+//B7Hy4WiylrvK3yO3lA" +
            "oLCyyENexdT54vXvffi9+Zd3krzWPCmjhoJUw+6cNVNVUlYlJcEwad7wNN8n8vpGIr/VSqg9AAf5Rk1KI8DbMkVsb29/+DC4c7U7" +
            "7741gK55WSIRNXY2ZbTocbH44IMPtra2mNnTV3fBha/FRyNYv0mp1+4ARAOriAXDSqIK5kEtrFQwD5k0O/sJsNS5xARtxYUCTPPX" +
            "d95/7/2v/sc3oo/SNSHgxP5qk/QETy+d1sI4f4DQyiB5RwFguVz94B9+sFwumVkuPd2hCBpVRxXYDGiUotlm7pQ8MRAoiAY0F6Sj" +
            "qcXANjBVtaUtEQwrs8fvlgTGMwT48pc6Z5D8ev311x9++HA+n1OIpDGIHEpy6M6g6uJTa6x8BlKrqCO8WyffxrXVavXo0aPVapVZ" +
            "Vap/zBrYSNtnJWmCV62fAZByA+nIGxiIUiBskYy7ZGtLCb5GoiS3KOoa3FkAJXGpHrrVEBUTPbcgsY83jF+K9dpspmz+13w+//Dh" +
            "hzs7O4YGCYh1MqrhdLzV1i6VycUasvgaEcN80ybEjBUNHDBkDnxQ7bhjgsolI2+99dZ77723tbUVaw7Mhf8lFxUdydBR+/trPKJ4" +
            "CsD5+fnHH398dnZm34dTK1ojwp57kJJHaomzFafYqoLD7Jqqyviv5iOTQV3oSMX02yxeV/S8fef2tx98GxvB7y+6NvJigkf9Y+Yt" +
            "ar+Hh4eHP3uao1ARtnRd1Tz1RschyGURREQDzVSViGeqHllVDVJV046CTVZAaBUr++e1115799139/b2/oIB/5nf+3dmlpFuxFfU" +
            "MwW9ChyfHB8+fbparXzsANEACKACxxq7HD3JEk57nckKzRRrEOr0rk+o2qPsXPeyb/gvr5Ardnd3v/Pud82dV/q6QeJP8GjKkfyN" +
            "eHddg9Y4st77arX64ccf/f73v4cID1CBxMIdtizMWSMI7xzYxMmBzFAasqShWdBd4uP2GoBr167dPzi4fefOnzvsyajSneczsAC8" +
            "Wk7vuSjuqm7UoI3COPzZ039+eig2HUDwWg+8dgxEEkIWqDqDEJ6deDYQKcTr8LGMzCbsWwJBRKphVord3d3vfue788V8M3HNbVOS" +
            "EXyJxyYMqhxZG2TXxeSP3g9ufHH1cvlPT56cnp5G+JmFSDe9EqmIGVchakDeyuds2seZyTyOl4AHkPOdnQcPvr1344ZFfH0E6Exx" +
            "RhRV8BrN1CG194nR0qwW9BbDqdwpZjjVIwoaqvYRYKj0yeHy5UvYmuVSFOw6goeOnq/Nrr3WKo9j1ZqWyAhGAFuvbd+9e/f2ndvb" +
            "29ubHA2Zs82eJpy6Mthr/KXmrjc/ENyZ3J+E6Y2hrsDEbfAnJ8efHD5dLpdMM1UFCW2EToB8RqPN0rj9ZyUo37y2de3u3Tt3bt/1" +
            "GOcV+l+tqR+AM+iqd5uou/rQn8GgK9halcsTDn9/uVwdnxwf//JfVqsVD6gFE9iyX26RdHPtlkZYSgHAErSdxfyb3/zm7dt/s7W1" +
            "vWlkV4/zFWpy1firt9qoTVfx6CpyOvPsX1aAcHJ8cnh4uFqtmFnkkpkrr+CxDDvuGu6kHu2++ebBwf3d67vxKLDuNeqw1z3OVfHe" +
            "K4Zn6sCEUcG2WGYtpvuL4tA1oytNOGT/6lenJycnn356CkDEc4OEFwJ7+AdAFbu71/f29m7d2u9UpoYnVw3sFXrRkRufuupUfEFr" +
            "jVwdBF3ZC2LsiKrAelSl3TvM/Ic//OHs7Ozk5P+enZ3lYigzMWxtbb99Y+/69et7e3tXmhKV1oMEb4XNvF2DpgBUjSX5EP62Mah5" +
            "/U2hzSsYtNFsJ8C0Rnx8pUmMmkmKrlarFy/Onj9//tvf/na5XNKd/3rnwTsPGgUdCnh+0cF87SZ1ta2gaBR2JE/AuwsCE8ZfwQWa" +
            "hpT55JW2TNMQqQ6qNexfhKQ6Mf/0pz/lO7dbKFwmgaxbLVyaEFy7105lJhFyzyqvJKxHwGVSrNKdXXR8mejZ5FnP4LXeL2sl2jYD" +
            "iqmaYE0Tvjnxe/fuzba3m02VMnCIND53I6qmUc1nSjQBWise6WiNYi39IZEh6JtyhLLmuHZV9TRnIvF6amqngGZPhgzkAiZE+wbJ" +
            "pIrPzy/48OnTJpM1BEAKk6b369gmH6+6GXpBU4doItA11KgtaNPojV2o1yK5GW8PfOtXgE+17q7jo6NnRAN/5Stf+ev/8Fdf//rX" +
            "d3enm0omUeYr/Nhffl0BORT68oqoEuXVDS5s7ZWNnNoI4UrnFxfPT391dnZ2enp6cXER6yBdD8fd3es3b+6/9dZb8/l8I+VY49qf" +
            "c00z1Y6u9ac3RxUdmmn/cG1yveUJg7Sgftw8Pz8/Pjk+PX3+4uw3sdRHPZImanXZTMG+duNrt27t3/jaXhJxZbmno6/knzUXWwvS" +
            "YClSK25c4Yw6gIdepcSb4G/DY5PnCQDOzl4cPj08++zXICLL46XlsV6Trjuw/GJV1fmXF/fv379586bfs2nDnBhZj32ok0/mX5Eu" +
            "UoQejJgNmPJi3aP/ycG/ysSom0FC082Li4ufPzs6OTlZLpeAwFKuEcaNnA0lWxgdjQ0gYZBqrIwQArCzmO/v79+6ub9YLCpTYOFP" +
            "DuwqkitY2AjDH13hl4IxtBbLKCZhgze6ITQl0HqmQoCen58/Ozo6Ojq6uDi3u5ZmCSmJTe359AQREc+GtqJFGSQQJfKikk2ejSrM" +
            "vPPvv3z//v2b+zfTrVYoVcvjwoF0SlyVCx3FmxiU4fb6yHsG1cFr90wPN63li4vznx/9/Ojo6PKLL2SSmDIJKSuRwnbrkA9zKLPP" +
            "ZWrQ9gXaQit7wOrQO/Odb33rW9/4L9+oGjSpARGzqnS2UEOVdW5sMCKsffEnUKWZ/BXX6enzJz958vLlS1X1FQheWeS0GFtCZ3X3" +
            "WIo5+KKY5stiupaI6opMz3GZANz4z1978ODBYrFoeUKfgmX9xW+/gkEbsXnCkbU7V3iM4v+K7qxWy398/Pizz36TrwwE9X3ABohe" +
            "urcimRtXaJBnEiWf4GSQ1Wvd58XmGYQ23bt3r+1n2ui101w2lUr6Ofu+KDEpg1IkhH0jU/ZuigmPnh09fXp4fn6eKzU2XsoKUQjI" +
            "dkBlyZVn4c/iVkxoxzrNXL9xOdb5eHvrjTfe+OCDDyp4b2SQm6F/bgtLu2pHA/5N0L0mgA0S6Rm0XC4f//jxixdnceNKBhGR2L56" +
            "7eaWYRoEoJ/0aK95Md+wRpQAHmw7kACggSG6WCwODg5u7u9vcM9XaRCF9+3jvaicYN15rcfWVzDIGz09ff74x48vLi4A9FseNzNL" +
            "WZNB1KHqAIqDSMLq6mDK/pmOr6Q2ly+qqsMw/Le//e8H9w4azYRalNow9+AimUxaxCsVa9KR2/Kq0Pe4vcYz4MmTJ89+8YtCrU4M" +
            "PKew2h0SU6QEk4yk850oWnmtk0EEjHmmi/VRS/q5CMaM8vr16++/957PeRBitdhVCzNcI7qAux+nZ4/UsQxTEXZQdH5+/tGPPn7x" +
            "4oWq5GxwQQ+NhWXJoDjxhe2Ui6G0HBPWRCTSlpo7BCkTs+olgG4e0rkZGsfJaVLVxWLx8H8+XMznyEmFcCydEoW+ELKy8cqSGLCB" +
            "y0hccxnYEqHly1UObxPuCMfydj91Bc2LDTSrs/CqI2EGYFMtmOx+S2VhSUZZ4u9QLQS2A1QEwM7O3BffrYWF6YIzBdkQ2uGK53WN" +
            "WzViUl2ulo++/2i5XKLUQNOOTIQiYqbEakstxRb2JINIbXkU5wrGXGmPbAgZJdcVMOl3y0Ly/M3lWJ9VEkrTMJ84Qu0WW1MutfBV" +
            "7dO3+ue7y5RTAf3d73//6PuPVqsl+c4aSiKnjdTRZgUvky3/t+zUj09TmjBFNcc5W31suyL8RCHKw3B8N81yufz7//X3v/vd79aG" +
            "WWq36zqbVW2DHu0fs5ps7GktjdByufqHH/zgjy//qLEsNVdC2+4dKqXV2oCtb23jL1LPq+UZlUrPRAqDc7N0ZVY04SqtfpKJEuHi" +
            "4vyjH320XC2nbGj+qTXXfdW7+ahBxsq9CMqT0cvl8tH3H33++YWI5BkYuTbQ9rvVrQGq+SFsIltTtYAmFwnDViSWJasEMCnn+o/c" +
            "/7O+oc46U4UgVGno9GK1XD569Gi5XPYimVgdHGK1vFt4qCV8d0ii6JuwXK3MnAVj2TuWg9dRR49gYhE086BKNVMloE1Lw/fca9jW" +
            "ZJ10YAqocrrpZ2RYkQAUi7EZ2u78L1qtlo8ePfr88/PKlLoDeO3qgc9/ty4pC+SE8/PzR99/9PLly/SheS5FwWYQkc2419XubaRx" +
            "pd1pH0O0fQwASGEnvqgqg9HtAnEzti0yOQoiUoIyUZyhkZdt0lwtlx9/9BEZpqjz28ZNayq5XpmncFXFLJxzH/3wRy9Xf6y8HmjI" +
            "0AwA0WDrEicupfQ2ilzqeGknGZF6WFwpKkd0qdoJQxOZNlQKh1/QqY1wcpiGxoJGIrx4cfbkyZP1Nifkls/Ni657Hvv+8PDwsxcv" +
            "1llsM+vWRJtij73y651edeUzTCozbh5RMAqUZ4PtpFcdY3NGxKDEqcLKUKaBZmzbHdqPeZA2tl8cPXt+ejrhjmqBmG5uVpsfy3XV" +
            "oYBQHP/yl08PnyLO74PFYoCq2lqvcpnDFekPb/SKDw2qJJ1c/SQT1VFVBlsK3JxixIe2/WCC9iJQ6jCrEqL98QLsx9IN7tmZ/vHx" +
            "4+VyOZGSa3QN+Vro539NnOZqtfrZz35GsRLOVDt3E0a/1K3QoC4di3NrbPd4t0esrSVXEEFE2OM7AdFA4ExG1NYMeZ1ogLRtjxZI" +
            "qCorsfp+USJqG/YNgFiVxM4bEugXX3zx+PHjwh7TIMkAoxO8OlxXL2aG98OPP1q+XNnhlVHbU8VIZPu8eojlmalJ4qwL2z2vY/BA" +
            "ea7MyGz5w8DMEWUrQCSxtb1qR9TSNFfJUnDHuCCSu+3HtSCgk7wSPvvss2fPnrW/C+iU9xqUhsdsPvjw6WGNP3PxYI58EkOPl7a6" +
            "su2P7i9XpWyHSlo7jgrf9MJ22EoXCnpQBLYzUbrWc9QM2DlDMqqVckQYHnl5A/aGuK89PDy06JGyJOQA07kYNbCpnRKtVsunh/88" +
            "EA/E0QsZPtr+2BybBXuqo51t1vsZCtJtpKNvs40f5pkveGYCD75OkcrG4Xq5JKk75mEiCe9U1SBIPaPoQIqIbLnkxcXF4x//GBQ1" +
            "HXRtBkpXvrTf//Tkie10HscxZ2JUDZvrTrHkVAviaqSS4p1koFouS/dlHNk2/ChBMJop+k876ETJjpKFxQm2J3qwmDsxi5RFkpUA" +
            "QCqx9wgqlyFJefHrs+enzwGN0zO7ALlX0XYdnxx/+umnNEQXwyw5q6o0wE5wycsLOHYOCakhDhHleYl+PlnQ7D9gUX/G9rt2WpMM" +
            "rla9LoHq3aoEXC6bAmWeDRqbEYnoyZMn5+clvHY3EcoySU0IAA4/+aSBURwYpKWGV0liP/CttNLTHF4vM7/UJQGVPd0A2zG/REqk" +
            "di6inT4QN4nIj5AzjTBtyvOk1eq4QhAdiAEWOy3DXBwx+dFhY+44U8Ly5erZs6OOhZG71KSMfFETjk9OVqs/QuPssHIsj/q2d/LN" +
            "3d6bbXGiyBNINY7osfMa1N8gZtsCh/YT3AQrnNNpqE2iVV9SPnX/Uy1RZ0K/rlP+LkesF/WaOvNL7Jm69vhj7S2Xq6dPn5psiwV1" +
            "dfjCL53NZgapWYGwr7rTZXoie4WX2jjXpzUOJwzAUyUZ9dJ0x2S1TpOI5L4FirMw86AuWPBZKl7G988vzn9+dGQG1ZG9hkLHx79c" +
            "Lv+/siprFKFaO86XEYhzPBKnS17aVMPxxVro9mQ0r+L+SkeCdBhERDU7GwbWmKrLYwZrpBCPDQlSE1fIE9nUkA84enbUIdHkCh6d" +
            "/Mux1vSvBPf5mW2XUwQ1Odqr9LoqeK24Z+SVLbTxiHSFIiWMowBkx1dmKXNUyd0L1p4hgB/22icc4eDayKwr1ZGBL87PjwyJJl6r" +
            "GNrxyfFqtWImUmYvALIhZh9JiOrY7acFkba9uDl7wxgMNEnZbFbgAbMQyI9pkIx789gYSz1aME7M5Afx+AL9DZYfR12lrDJCSe5s" +
            "vPKb4+NjoAt2Jn8eHh5WfcmcK1WDqK3+Sl02SiZHLayTRJlzAwrGpm85lMrYDFX4nP5ovPAT4jTP/kIjCAZAZZ6kqnRV2u6ID3Cc" +
            "Kc4vly9fnL3oyon+Mgg4PT19+XIVMS6SNZE65MYJrsgdWqyqY0bYSR5EGWTxkZNqft1nt9rJs65B9kdh9rQqmNdEbtXOq21TXwN2" +
            "ppe0oz4J4JNPPuk1p0XVx8fH6TRblWf0//7AQJB51o7RXkvNxnL8Y3XKG7V7ctOMI3IQ0ZhBHcAzRVffWX/Z74jmUXTrWFjY5xFt" +
            "HMLWziFSwovffHZ+cR4ZmbMGhOVydfr/Ts1DEClIBaPIZZFfqFU4xzykzjggInZOq/HOUQk6qV4nUJLC4MlwygWAUB8ugOLlPO6C" +
            "gGwxFSo9yEQyhcrW/bpw0iKOT46zn+AQXrx4kTcA+LKuiVeMRLQ5nYghM5LOqvNGEebYs5HJk8FysjMiRxHBCBKCHUQIAH7y+ERF" +
            "s3UpR20nFjYbDIBnxH9+ArZKQtJ6evo8JZpx0Mnx/4Hk+fmceUGG4wz1gmHQlrGPqsLOktI4KiKQiJllHHWU/CFVHS8l0heL4DJA" +
            "4RSy/VscZ5V2A51kSnLBGjUFro4jPgAS/jGqSxM3d3Z2dn5+UaeqV6vl2dlZfdi/KuR5Hk1NHimk6jqqXsOKpakvDg5O8ETq4cVK" +
            "ZEl21LglbDqa9O0ANCOl7vSdzWZZu0SEHhmJ+JKPPINXAIniKwXeNBPW0+e/qkHlr399FosuOs/o+Q3Zrv8WYRANFHBhg7RgbRgG" +
            "K/INQwisnAOJQC6jqtkBtUUZXcmiqFLnsCYHu6U2orr52NTpZxFwpyP5n3mkVKuSEuHs12f1zumnz52zExQzhBRHfrMA0qYmteWk" +
            "TbU7T7o9Foe4V12bqN5MR2Do4y772ghXVgiYRUfyVRCggWNWgDRiVq0g2tkp217+MtfsJ+ygDOn09LQG0L/77W+pLSrxBIIpAMGg" +
            "nAReEgUgtovFqLLsUMNSfAkCQ3IFK1GS6px3LhtIj83iiHydXWVt8wHBzDijwqcE8j9eco+WI1ZLm6zM7RP2Whxfrzit34svzn/y" +
            "kyfLPyzPz8+f/OTJ6uVLNLrF9qsbd2owXSWan6U73q47YXrioeqVEF4fBvBvwZvfB2giLLAAAAAASUVORK5CYII=",
    },
    "v2-96": {
        size: 96,
        sha256: "e5e95a3cd28454a1281465519c1b6209c22320856e2bc3074d2386d75cd8bff1",
        origin: "bg_96_20260520.png: src/assets/bg_96_20260520.png in GargantuaX/gemini-watermark-remover at 1319561",
        png:
            "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAAAXNSR0IB2cksfwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAjFQTFRF" +
            "AQMCAQEBAAAAAAIBAAEADAwMKCgoPT09QEFALzAvDQ0NAgICAwMDEhISMTExRERERkdGNDY1FBQUBgYGGhoaNzc3TU1NTk5OOzs7" +
            "HR0dBwcHDg4OQ0NDWFhYKSkpAgQDGBkYMzQzTExMXFxcS0tLMjIyGBgYAQIBBAQENTY1W1tbNTU1JycnOjo6SkpKAQAAFxcXNDQ0" +
            "QkJCVVVVQUFBHBwcPDw8RkZGU1NTVFVUPTw8CwsLR0dHUVFRSEdHMzMzUFBQUlJST09PGRkZCAgIIyMjVFRUPj4+Dw8PLy8vRUVF" +
            "VFZVR0lINzk4IiIiCgoKTU5NSktKLi4uEBAQERERSUlJSEhIFhYWBQUFLC4tGhsaAwQDAgABJCQkUVJRVlZWPz8/LCwsExQTBwgH" +
            "Hx8fODg4U1RTCQkJDQ8OMDAwS0xLT1BPLS0tCAkIHyEgV1dXTk9OFhcWMDEwBAYFBAUEExMTKysrFBUUCw0MUFJRTU9OTlBPCQoJ" +
            "ISIhU1VUISEhAgMCHB0cNDU0Tk1NTE1MGxsbLC0sBggHT01OQEBAUlRTQkFBUlNSCQsKUFFQCgsKFRUVLjAvJSUlJiYmMjQzP0FA" +
            "ISMiERIRMTIxHR4dDg8OMjMyKioqPT49REVEVVZVWFlYKCopKCkoRUZFPj8+Nzg3JygnEhMSJSYlDhAPT1FQVVdWQUJBBwYGGBYX" +
            "GxwbR0hHICAgDQ4NOzw7JignCwwLFhgXPD08IyUkXV1dKSop2y42xgAAD+9JREFUeJylWg1wVNd1PuftvpXek7wSSFAwCJAQkrWS" +
            "FjC2sbA9Tk3dkBacmRqwgdpjxxknce1M2qYzJG7jdsbN1E4aT4fE/84kccDFOG5rmYBJsGPXlaCuXP0gKRJYEhKx+BMggd6utNq9" +
            "vffcn/d2JZFm8vRz97133z33feec75x77iIgMv4DwAAs/g8hA+Kcn9K5xeQ5XQ+hOJL8Fj9nTF/Xz4UYY/Izf5qhuh8SHcU1ZCGW" +
            "QSkAxKBOgnewmOgMyFtWQOPjpOd4aK5Dhj/HqJ9FzzP1jHjeTfCOSB3UwVg4DeJ9LExLoVyguM6vwRwpAE/TFaB+SG+aAf/go/LL" +
            "FshxeHfRMSP6OZ7r8fOMkCZmQlJZmJ8j/cK15+bzy1Z6mGAAAlK0ITEYQ3MuWj4x8RBySXy0xYN0j/9zkuJDGt1kmqPpehLftCWw" +
            "ZUvFdMQrnMiQFsTE5KDqOci4CcKd4xmicTiGTsIoRWDF9SAG1Q9AaIpE8FnmlY0WT+TDZN6FIiFA6UXozVI6kOPo60wagiVGBg6b" +
            "fl1GShefcw43U4F4EeYw1md5LOe+Og828jOXRhYDWoBQLoEn/rkJx+O366GDf5xThjhWBKPFCTvZy891L25STHTVg9B18ZzUSwik" +
            "7ZK9i4tpslzC3bymwBWL+AtwLZ+ZF0r1XQSFPWQIViQ1Kx9Q9s/IzDHMBN4CR7J/lI5DytP2TQ9Yy0s/uqkXquE3V647Ek6gHEjh" +
            "zScmBFB/+gTmPiIoiCRUpGSCCmQr9cE7uJVFiJ11cKw6NDr3Nz0W5HsoEZH3ZaucVMHDSAfc44AZO7ZIsutZwh8ElPrp9ThaDK38" +
            "Y4UTee+Od6hfjj8geQ5qI5HXLckrdCqcTOKPkn9Eq3jHXbEQ8UIfv1kejfAX/yXZnbQ2PT2Cha5lzHPCijBovxaRVkZZWIbmLxTW" +
            "4DZXu6kuButGwsUH/gQPeghab3L+IPXoQEITJrUWvQnnCBDmBjS4cAzhaHqGvIu74VBV+Wno4ScxOHX9B7fj61Jx6j7z9SB5StIH" +
            "kACfR4jc8oTpC38IXm8o+ThVsAyOSZGx0u7Fh9h0vJkmevT5KeTbrcQPM1zpEDwX9ws2JsfbxNTWQVNd58q26I34mrTzDG7fE4wP" +
            "pMcMmvOQjz+Ab7/EhqK10oLQ74r2XIcnu/hAXADUjbrLEZt6yM6VAKUPom79p8zUx03bsKJa3y8eRNy3teWaLmmFUOfZkyfrK15E" +
            "on4I2D6QZYemhBXugD3iHEk7XMHGqYiPlPtJXq/6QxwpxfZeHZawxjq/uOKFNMUW/VxAj3z2rudWtislB+OrtmMfT9H+Bf74gfZO" +
            "ZAIecaxb9lptyr1Q9J7uRzCi4iVhWUjRyklmyJMNjwf9ISDAeRhPNVd2kYL1XyzizT92414VFwgSoGhoEXkiaUS8CQnQ5kx4Ogkw" +
            "9kwQVday8U8qJoubgvwfw6Hi0ZEHn8mKBqDiiSWHUgLIhDV+mrDQ8Ir1l4h75p6pWTXQRC+oYMKablZ1TfwH4z77SGylBYk3UBYZ" +
            "CuJI8UDaleQjfvdvWpadq3kFt7kv89GbjIBtBR/0zl811khmqp6XPBaWkWfxIITID5SCgvEANa8w695yfL46fefzQfyVoo9ER/se" +
            "aV39D8IPePbA6VvymM5B+JtQViF4SMVrY8sEE12/63rcP7Ay1VUQFwPrN3hsF3z1fIvTtuzK9sGXmLF/7WjKVDUXBfg80Ooos/XZ" +
            "FItZx8TA2ABrYJfS5rqmukwX2tsPHU+QH0mrcDyLQiUXhBlm/IDMMsg/vI1DB3wrb2/DR44zFdWwwM0pLUAcWz4Ob/xVFBuTQf+h" +
            "TCpwzmeZ8P0gIxMw7snx+t2wcP7qjsmiMPoCVKssdsvSxtHIHYeu22f8h/TGESL/kTBZGpEcPfAzZ8Xq697p3NZ+bB00M61gbAj4" +
            "Q11nLXx25NBxT9E28/NUFpLttHhgeMX5o+7ldxwoq/8Ogy92NdGs9Z+kPOoZGysamxdNHh43PCTjCCDOEg84n8j4/HRy9N3JUrbp" +
            "g6ag/ee2sY2n3o3c8d71LwWeZ/H6Pb4+Q1Lrin+UHziJqi9dePNUHHqhwbd/Qk68jVIEnW+HFugv2tzac0KGSGE9RoCfF+X8wdab" +
            "97dWFIRFkNdmqfwAzRV1YMxuW9a3alVjj044DXVQGLCkSrLt332y58Oi46yOYrCEnPCHJph+8F54e9Gc59i470d+PuXTtbZb/vHR" +
            "xqXpSHjMzTJP0kMzy9JD7GVqd1460hqpj44MwfFp/kR5kb8O437g7vhh6c5Xh6pSth0N8E+Qh6Qp6QCEbEv5G/mnllekDtS8C2DW" +
            "b3LiOh5oP3Axsqb6+KVEaSeAiZBs3UzQmLsyeBTc8A7beu4tE0/0uFYAfxc2/efEpgNLI04KO1nhldlH1SOro/AK1nproaWm/vH4" +
            "yFACAsrO8oOHz4dvRfxJojRld24byMVfmmUu/iY+OEdgaMFk7Y34s2aZV5G50/pABrwVqy9Fwk23vb/z3+xONs2hZm21a1O+5Nmj" +
            "F/7254NDE9ygrIz0Axm/3MXnxsoHir7ecs4ese3eXFvXx9V0wY9YpOZof9nJzSfO9TrzTolFFC2YOfj3/KzWvv+H88fHvMtQC52z" +
            "jp/tB9N8rg4y3ez24ej5VOfKisYlPdKK3Cja39hlD1eGMXn3290sMFGNc66Aq7RYm3Lg8pY3TyxMjVzz9aN7x9H99lP2330vnBfq" +
            "r05B1WA3y8F1ptafQTYvibaWgX357qfLU6lMaf+tjUn83Gm7Zx64XuaKXEX8lmMaLDN0AWhoKhRxoXhNeA0+0D0QieRdnm/btmGe" +
            "31GGiVHmQm0qlTobgcnJZBJfwZ15QsCabrLOLDxZdquv57a59xG4gC/h0xOTk8tq8Mdtr+ZFoNDLxJtQLTBmGyhrntOY1eitWQxT" +
            "uGG4A5JTJUvQzt+04ZWzYdvur7UhNWXPaqP/T+ywJu2M2T3l6YnM5ERqwkEsiP79tydKhJlGABK/jwAppQbtFJsSZhr7NRsbp6xi" +
            "BQ5W2W1L5zz2wrX136+xOtlvMdPZ2u2p7k64ZvXwl/ue5I52115LxgM3YTFn4y8SVUsq1zwzVL72aH7xTHb/xZen6SOH+PCz+S0Q" +
            "Lb3hu//yzbMOTLAEBRxBdjxQc70URO8p/NfE3PvfMJEM4K++N82ppsNu4K9NhboWnN1c8vJte03oxJAsS1J94omR4dreT3Dky/tZ" +
            "t/Y530mvDj3UpEMXnJr+zR9OTTUG89ywqYvme+iUlTyKh0cXvrnIjQ+0XxFZ9DSa0EdQogg4G36Z8k5+bvDhj56DrHV2SFUXLZ3H" +
            "fLfz9VtPeWPb4TUGj32fmTwo6xCSA9fFSOs+rSnsOZLxrOz1HuVFIaUHmb4siC+2+4bnJh2cRh2z4FSXStk9f320efS+93tN5i8P" +
            "GQ9oXSXrpRT515ekBi5VjuV35Y4/Y17EBXjRthVncMlhCNQtdP0uBBm/jCYSVhFH752ouNg+ALve3wfBhItSl2nndXCz9z+ji49O" +
            "elSnA1PfALUIlFYkSga6pBliKza1tlZHEvX/wYKJr/aHLNPd3mav2G2vavnj10HWlyCrnkd+AEoPuoDKpVfdvuCNU9dDF1w1JyJI" +
            "YuCc5MlvLwRKYLQcEJVPscrEwKINqWhBec3DH9d1iPT9n646fgxxMLqycvDFYN1O6UGUUv26qar/+/sB917pXn80ennbh2LxN+v6" +
            "oPaRoZ+uPVxz2MOcukWgXqTrpFIHUhdC4Rln0S0dTtxuP5alB9+ixPO1G5fs/69PPVpI0jqDCuSUn6p1N9XVqZyZ0XVPN6HKCm9g" +
            "Y9tY2Z/275sFnzoGI+GV/zt0ccZyBOh1slzbUIUL9OLBpfzezS9rOFq0wp5VgOeMrm0+O5qYYZ1t2rCcuanPmXo1GYW76JYzLWzn" +
            "J/uy8Sd6rssUL/rpn3lvJ8S6LFDnY369jtbJlqxbUwGEOxrVG8Dsgmx64JvRgYq7v1MgUm1j/lxQ4XjMjn3m8e2DL6r1BTiS/ym+" +
            "BOp/tDJnYChb102pNsBcXL/q2YqisX5yODD5gyC701Gv55HTu8d13Q6z1wV6RWapjRFdJ6VWTEf+MusbJ1vnpXph256A/XCaBRbr" +
            "+vyA+9aMuAdb8X5qPSXroEIcqPxeVB7uObD2ci/WrNoDQT3g5uK9yTtLn/Oy1mMztULJej0F+gZBRcDyN6w8Wz9+qYwW5H4cjk2s" +
            "9s58uKjXXw+Tg0n+IX0qfagtFhrbnWCqoCqgUQTIZ+Feu74j4fZkWWjtiTm3XNg/DnLFGkRFU4XSB6Kqj/r1NsmoFlUQ5SbF+s6v" +
            "HcTOrMy4Nv6jn+x6l4HeDWJmXZyrByvIGwH8QmLrRby2xYW++VzzktJMd4POf5a8PXDDwamEpfcdlP4yIZbNQ3qbS9fpEMy+AfGT" +
            "JWOEtXzL0a8+hSn3mHKELSWHWJz9/HR2nRV8/jHxQNZN+c+O3dyLVTmHdjOZLIqLfQUL0tWbzn/qeUU6RseW9k1Uj72lMZcIq5pd" +
            "YB9Bl9QYxAHahf2LMqDat+ACEKi8TfmBc/PgaJkSUNcJ5ec3OP+cjbcpggQ1PuP+wcztwhdeudRF6X3sCAyM2w/ddNe055xEFv4o" +
            "CFzXTc0+jLIiBL9+RDjfc3/61Y8XQzdbByOwoL/3zvJnzP1gP71vQNbJKB6Ier+KyzrTDJk4ndGlCOc2d+3ukrKDVB/yvrLXa/bo" +
            "/gz1VpAxxcQDFY/j0GHw1PbP9SJoQ+weuX++4NnqNOOkhytHvrZn+LgHOoZMq7eKfTnanEO5X529XxbKig9pcx3zKxYthX9HaPDG" +
            "nsAvDKt+Pr3oOACybpe7j2bqdWp/WPFJwK6r8vG+1oN1EB1lmyu2jotd20D+k7X/YxlFZ2TlN2i3IqIxEH6h9GJ4xZl6/Ufti6Ck" +
            "qeq/2ZRJ0vyNLTISzmeGw6QAtVlq7Fjg7ybqOxRdK+WLm3MqvnXf3PnxJY2M9V3UcSPb7mmDwn/O0qmj714yHozL/XiajaXzJCwq" +
            "w3P5RY9+dIT94+FnsvIfH05qd3S0o/iegDwP+/VSMi25ByM32rg3m317xHy55X7DCbHlDgH8s/yBK3h7R/1uVX/1xAA7OjpMPHV1" +
            "ORL9YjfohL9qtDgVgaRzoag3kCL6qSK1omaNLN6uN125kuvbDZ+IqJMAo1ztD9qLlj7+FHv2K2XDxwPZWS4fyX2DHbtNPKFvJVg+" +
            "j4iVDuoCt3ht+bUIev3nl32Bfzw777QpG2fYtP1jda6/jyH9QPGR9oMAv2Th/OBNTzD2+WU/OJN1HyHQ3zF65JMkU7YUAvLrC9IP" +
            "fM8XBC4XV0Kw++RLhb9+6KVFvczwkJvI2s+P1+9RHGT8JFA3pQRWB32Tp0qedJKY5+HC+B/cZj+UNv0ofwryf/yEJDl/P/r/ALza" +
            "vvlMz8kpAAAAAElFTkSuQmCC",
    },
    "v2-36": {
        size: 36,
        sha256: "a3e7d5ca932e6acf9ff826a4db47d597458480e72089da81a40bd4b52668cd31",
        origin: "bg_b_36.png: the bytes of bg_b_36_png in assets/embedded_assets.hpp, allenk/GeminiWatermarkTool at 7c6a99f",
        png:
            "iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAAAAADEa8dEAAACWElEQVR42l2UQW8bNxSEvyFXttRCgRXLjtIAToMcAgQtGrSH/v9r" +
            "0aJFCwQ9JEDsQ604ii1DtmRbIqeH5e7KIggsuTt8b97bGSrwaMg/V78hNzsAqu3voPTthMFSyMgU7FYgg2C01xsZ6lneP85mh+fo" +
            "efAjBjsgeXiEn40z2PWp7Ugqz5N+SvsvAygAlkAODUaA8sEJJk/GWbg+aluhIWNQ1tvBBtLeK7mQN4KoLYL59auchRnmWRQISTwG" +
            "pe9+UhJSjoc310IuwAYkKY3fDXIJ2RvNl0KlWVEgIUiHvwzXFoCV+4fXS9XVtelkv3g3XJdOCPI349WiaVANUtKbH/ubrvOB3J+k" +
            "eZawiBJkjn94GZNVumoJcjx+enNnhWCFjMbfP9vf5K7OwixWq7OzRSYoDEaTyX5OYJUJuK6s5/uL86uVfj3qyclqIaZdKyvC+jwk" +
            "hATdVLt2nbmSBk8nx3023qUEVtTDdHp5p5AJw5OTwSapoyywHOP959NZJigIZx28PVLaKa7y9OPMofktQcv/1od7uUEIoEr//rMk" +
            "AI6lJfnqZtTPrklb0Fv++akWCoqhaF3X83EtAhDeW/x+0eq/05Nu50f7uWi2d/vH19iIoNUTVrhdTmKWwTH9dRGNjCR1kYTCgrEQ" +
            "jnp/GlHroQIyCPny4EkGep//boWl4i5AdSfzh3VlenfvM43T3fmuRA6zqSSfzcOWX3fvAnH6EMP9WSmrobVzYWg2lb4sIqZ4zh2n" +
            "duRzOM/FG7V/oQJZ7VUjXT1wKQPGyA7GVb3r8q0u0qqrpRbe/0CQHApT5xVtAAAAAElFTkSuQmCC",
    },
};
