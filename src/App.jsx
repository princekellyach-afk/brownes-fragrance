
import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import Admin from "./Admin";

const WHATSAPP = "233202511522";
const PENDING_PAYMENT_KEY = "brownes_pending_payment";

function Storefront() {
  const [cart, setCart] = useState([]);
  const [category, setCategory] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [question, setQuestion] = useState("");
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");

  const [placingOrder, setPlacingOrder] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [confirmedOrderId, setConfirmedOrderId] = useState("");

  const [trackingOrderId, setTrackingOrderId] = useState("");
  const [trackingPhone, setTrackingPhone] = useState("");
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("");
  const [trackingResult, setTrackingResult] = useState(null);

  const verificationStarted = useRef(false);

  useEffect(() => {
    async function fetchProducts() {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error loading products:", error.message);
        setLoadError("We couldn't load our fragrances. Please try again.");
        setLoading(false);
        return;
      }

      const formattedProducts = data.map((product) => ({
        ...product,
        image: product.image_url || "",
        topNotes: product.top_notes || "",
        middleNotes: product.middle_notes || "",
        baseNotes: product.base_notes || "",
        price: Number(product.price),
        stock: Number(product.stock || 0),
      }));

      setProducts(formattedProducts);
      setLoadError("");
      setLoading(false);
    }

    fetchProducts();

    const channel = supabase
      .channel("products-live-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "products",
        },
        fetchProducts
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Verify payment when Paystack redirects the customer back.
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const paymentAction = searchParams.get("payment");
    const reference =
      searchParams.get("reference") || searchParams.get("trxref");

    if (
      paymentAction !== "verify" ||
      !reference ||
      verificationStarted.current
    ) {
      return;
    }

    verificationStarted.current = true;

    async function verifyPayment() {
      setVerifyingPayment(true);
      setPaymentMessage("Verifying your payment. Please wait...");

      try {
        const savedPayment = sessionStorage.getItem(PENDING_PAYMENT_KEY);

        if (!savedPayment) {
          throw new Error(
            "We couldn't find your pending checkout details. Please contact Brownes Fragrance."
          );
        }

        const pending = JSON.parse(savedPayment);

        if (!pending.orderId || !pending.checkoutToken) {
          throw new Error(
            "Your checkout details are incomplete. Please contact Brownes Fragrance."
          );
        }

        const { data, error } = await supabase.functions.invoke(
          "paystack-verify",
          {
            body: {
              reference,
              checkoutToken: pending.checkoutToken,
            },
          }
        );

        if (error) {
          throw new Error(
            data?.error || error.message || "Payment verification failed."
          );
        }

        if (!data?.success) {
          throw new Error(
            data?.error || "We could not verify your payment."
          );
        }

        if (data.orderId !== pending.orderId) {
          throw new Error(
            "The payment order did not match your checkout. Please contact Brownes Fragrance."
          );
        }

        sessionStorage.removeItem(PENDING_PAYMENT_KEY);

        setConfirmedOrderId(data.orderId);
        setPaymentSuccess(true);
        setPaymentMessage(
          "Payment successful! Your Brownes Fragrance order has been confirmed."
        );

        setCart([]);
        setCustomerName("");
        setCustomerPhone("");
        setCustomerEmail("");
        setDeliveryAddress("");
        setDeliveryNotes("");
      } catch (error) {
        console.error("Payment verification error:", error);

        setPaymentSuccess(false);
        setPaymentMessage(
          error.message ||
            "We could not verify your payment. Please contact Brownes Fragrance."
        );
      } finally {
        setVerifyingPayment(false);

        window.history.replaceState(
          {},
          document.title,
          window.location.pathname + window.location.hash
        );
      }
    }

    verifyPayment();
  }, []);

  const addToCart = (product) => {
    if (product.stock <= 0) {
      alert("Sorry, this perfume is currently out of stock.");
      return;
    }

    const alreadyInCart = cart.filter(
      (item) => item.id === product.id
    ).length;

    if (alreadyInCart >= product.stock) {
      alert("You have added all the available stock to your bag.");
      return;
    }

    setCart((previous) => [...previous, product]);
  };

  const total = cart.reduce(
    (sum, item) => sum + Number(item.price),
    0
  );

  const sendQuestion = () => {
    if (!question.trim()) {
      alert("Please enter your question first.");
      return;
    }

    window.open(
      `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(question)}`,
      "_blank"
    );
  };

  // Create the order, then initialize Paystack securely.
  const placeOrder = async () => {
    if (cart.length === 0) {
      alert("Your shopping bag is empty.");
      return;
    }

    if (
      !customerName.trim() ||
      !customerPhone.trim() ||
      !deliveryAddress.trim()
    ) {
      alert("Please complete all required delivery and contact details.");
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      customerEmail.trim() &&
      !emailPattern.test(customerEmail.trim())
    ) {
      alert("Please enter a valid email address.");
      return;
    }

    setPlacingOrder(true);
    setPaymentMessage("");
    setPaymentSuccess(false);

    try {
      const checkoutToken = crypto.randomUUID();

      const orderItems = cart.map((item) => ({
        product_id: item.id,
        name: item.name,
        brand: item.brand,
        price: Number(item.price),
        size: item.size,
        quantity: 1,
      }));

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert([
          {
            customer_name: customerName.trim(),
            customer_phone: customerPhone.trim(),
            customer_email: customerEmail.trim()
              ? customerEmail.trim().toLowerCase()
              : null,
            checkout_token: checkoutToken,
            delivery_address: deliveryAddress.trim(),
            delivery_notes: deliveryNotes.trim(),
            items: orderItems,
            total,
            status: "Pending",
            payment_status: "Unpaid",
          },
        ])
        .select("id")
        .single();

      if (orderError || !order) {
        console.error("Order creation error:", orderError?.message);
        throw new Error(
          "We couldn't create your order. Please try again."
        );
      }

      const { data: paymentData, error: paymentError } =
        await supabase.functions.invoke("paystack-initialize", {
          body: {
            orderId: order.id,
            email: customerEmail.trim()
              ? customerEmail.trim().toLowerCase()
              : null,
            checkoutToken,
          },
        });

      if (paymentError) {
        console.error("Payment initialization error:", paymentError);
        throw new Error(
          paymentData?.error ||
            paymentError.message ||
            "We couldn't start your payment. Please try again."
        );
      }

      if (
        !paymentData?.authorization_url ||
        paymentData.checkoutToken !== checkoutToken
      ) {
        throw new Error(
          paymentData?.error ||
            "The payment service did not return the correct checkout details."
        );
      }

      sessionStorage.setItem(
        PENDING_PAYMENT_KEY,
        JSON.stringify({
          orderId: order.id,
          checkoutToken,
        })
      );

      window.location.assign(paymentData.authorization_url);
    } catch (error) {
      console.error("Checkout error:", error);
      alert(error.message || "Something went wrong. Please try again.");
      setPlacingOrder(false);
    }
  };

  // Securely check an order using its Order ID and checkout phone number.
  const trackOrder = async () => {
    if (!trackingOrderId.trim() || !trackingPhone.trim()) {
      setTrackingMessage("Please enter your Order ID and phone number.");
      setTrackingResult(null);
      return;
    }

    setTrackingLoading(true);
    setTrackingMessage("");
    setTrackingResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("track-order", {
        body: {
          orderId: trackingOrderId.trim(),
          phone: trackingPhone.trim(),
        },
      });

      if (error) {
        throw new Error(
          data?.error || error.message || "Unable to check your order."
        );
      }

      if (!data?.success || !data?.order) {
        throw new Error(
          data?.error || "We couldn't find an order matching those details."
        );
      }

      setTrackingResult(data.order);
      setTrackingMessage("Order details found.");
    } catch (error) {
      console.error("Order tracking error:", error);
      setTrackingMessage(
        error.message || "Unable to track this order. Please try again."
      );
    } finally {
      setTrackingLoading(false);
    }
  };

  // Search across perfume names, brands, categories and fragrance details.
  const visibleProducts = products.filter((item) => {
    const matchesCategory =
      category === "All" || item.category === category;

    const searchableText = [
      item.name,
      item.brand,
      item.category,
      item.description,
      item.topNotes,
      item.middleNotes,
      item.baseNotes,
      item.concentration,
      item.occasion,
      item.size,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesSearch = searchableText.includes(
      searchTerm.trim().toLowerCase()
    );

    return matchesCategory && matchesSearch;
  });

  return (
    <div className="store">
      <style>{`
        * { box-sizing: border-box; }

        html, body, #root {
          min-height: 100%;
          width: 100%;
          max-width: 100%;
          margin: 0;
          padding: 0;
          overflow-x: hidden;
          background-color: #f6f0e4;
          background-image:
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 800'%3E%3Cg fill='none' stroke='%23c49a4a' stroke-width='2' opacity='.34'%3E%3Cpath d='M-80 120 C90 40 120 220 280 145 S470 20 620 120 820 245 980 130 1130 45 1280 100'/%3E%3Cpath d='M-70 138 C95 58 130 238 290 163 S480 38 630 138 830 263 990 148 1140 63 1290 118' stroke-width='1' opacity='.7'/%3E%3Cpath d='M-60 620 C110 540 180 700 330 610 S520 490 680 600 850 720 1010 610 1160 520 1300 580'/%3E%3Cpath d='M-55 642 C115 562 185 722 335 632 S525 512 685 622 855 742 1015 632 1165 542 1305 602' stroke-width='1' opacity='.7'/%3E%3Cpath d='M760 -40 C690 100 850 160 770 290 S690 450 790 540 910 690 830 850' stroke-width='1.5'/%3E%3C/g%3E%3C/svg%3E"),
            radial-gradient(ellipse at 15% 20%, rgba(255,255,255,.78), transparent 48%),
            linear-gradient(135deg, #fbf7ef 0%, #eee2cf 48%, #faf5eb 100%);
          background-size: 1200px 800px, cover, cover;
          background-attachment: fixed;
        }

        .store {
          font-family: Arial, sans-serif;
          color: #201d18;
          width: 100%;
          max-width: none;
          min-height: 100vh;
          margin: 0;
          padding: 0;
          background-color: #f6f0e4;
          background-image:
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 800'%3E%3Cg fill='none' stroke='%23c49a4a' stroke-width='2' opacity='.34'%3E%3Cpath d='M-80 120 C90 40 120 220 280 145 S470 20 620 120 820 245 980 130 1130 45 1280 100'/%3E%3Cpath d='M-70 138 C95 58 130 238 290 163 S480 38 630 138 830 263 990 148 1140 63 1290 118' stroke-width='1' opacity='.7'/%3E%3Cpath d='M-60 620 C110 540 180 700 330 610 S520 490 680 600 850 720 1010 610 1160 520 1300 580'/%3E%3Cpath d='M-55 642 C115 562 185 722 335 632 S525 512 685 622 855 742 1015 632 1165 542 1305 602' stroke-width='1' opacity='.7'/%3E%3Cpath d='M760 -40 C690 100 850 160 770 290 S690 450 790 540 910 690 830 850' stroke-width='1.5'/%3E%3C/g%3E%3C/svg%3E"),
            radial-gradient(ellipse at 15% 20%, rgba(255,255,255,.78), transparent 48%),
            linear-gradient(135deg, #fbf7ef 0%, #eee2cf 48%, #faf5eb 100%);
          background-size: 1200px 800px, cover, cover;
          background-attachment: fixed;
        }

        .store > .topbar,
        .store > header,
        .store > .hero,
        .store > .section,
        .store > .about,
        .store > footer {
          width: 100%;
          max-width: none;
          margin-left: 0;
          margin-right: 0;
        }

        .topbar {
          background: #171612;
          color: #d5b66c;
          text-align: center;
          padding: 10px;
          font-size: 11px;
          letter-spacing: 2px;
        }

        header {
          background: #171612;
          color: #f5eddb;
          padding: 24px 7%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 18px;
        }

        .brand {
          font-family: Georgia, serif;
          font-size: 27px;
          letter-spacing: 3px;
        }

        .brand small {
          display: block;
          color: #d5b66c;
          font: 10px Arial;
          letter-spacing: 5px;
          margin-top: 7px;
        }

        nav {
          display: flex;
          gap: 25px;
          align-items: center;
          flex-wrap: wrap;
        }

        nav a {
          color: #f5eddb;
          text-decoration: none;
          font-size: 13px;
        }

        nav a.admin-link {
          color: #d5b66c;
          border: 1px solid #c5a45d;
          padding: 9px 13px;
          letter-spacing: 1px;
          font-size: 11px;
        }

        .cart-count { color: #d5b66c; }

        .hero {
          min-height: 480px;
          padding: 75px 9%;
          display: flex;
          align-items: center;
          color: #fff;
          background:
            linear-gradient(90deg, rgba(15,14,12,.94), rgba(15,14,12,.35)),
            url('https://images.unsplash.com/photo-1595425970377-c9703cf48b6d?w=1600') center/cover;
        }

        .hero-content { max-width: 540px; }

        .eyebrow {
          color: #d5b66c;
          letter-spacing: 4px;
          font-size: 11px;
        }

        .hero h1 {
          font: 54px Georgia, serif;
          line-height: 1.12;
          margin: 20px 0;
        }

        .hero p {
          color: #e1d9c8;
          line-height: 1.8;
          font-size: 14px;
        }

        .gold-button {
          display: inline-block;
          background: #c5a45d;
          color: #171612;
          padding: 15px 25px;
          text-decoration: none;
          border: 0;
          cursor: pointer;
          letter-spacing: 1px;
          font-size: 11px;
          font-weight: bold;
          margin-top: 17px;
        }

        .section { padding: 75px 7%; }

        .section-heading {
          text-align: center;
          margin-bottom: 35px;
        }

        .section-heading small {
          color: #a17f39;
          letter-spacing: 3px;
          font-size: 10px;
        }

        .section-heading h2 {
          font: 36px Georgia, serif;
          margin: 12px 0;
        }

        .filters {
          display: flex;
          justify-content: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 25px;
        }

        .filter {
          background: transparent;
          border: 1px solid #c8bda9;
          padding: 10px 18px;
          cursor: pointer;
          color: #332e25;
        }

        .filter.active {
          background: #201d18;
          color: white;
        }

        /* Product search */
        .search-container {
          max-width: 620px;
          margin: 0 auto 35px;
          position: relative;
        }

        .product-search {
          width: 100%;
          padding: 17px 50px 17px 48px;
          border: 1px solid #c5a45d;
          border-radius: 3px;
          background: rgba(255,255,255,.92);
          color: #171612;
          font: 15px Arial, sans-serif;
          outline: none;
          box-shadow: 0 4px 15px rgba(0,0,0,.04);
        }

        .product-search:focus {
          border-color: #8c6b2e;
          box-shadow: 0 0 0 3px rgba(197,164,93,.16);
        }

        .product-search::placeholder {
          color: #777064;
          opacity: 1;
        }

        .search-icon {
          position: absolute;
          left: 17px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 19px;
          color: #a17f39 !important;
          pointer-events: none;
        }

        .clear-search {
          position: absolute;
          right: 13px;
          top: 50%;
          transform: translateY(-50%);
          border: none;
          background: transparent;
          color: #6d6049 !important;
          cursor: pointer;
          font-size: 13px;
          padding: 8px;
        }

        .search-count {
          text-align: center;
          font-size: 12px;
          color: #756b5c;
          margin: -20px 0 25px;
        }

        .products {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
        }

        .product {
          background: white;
          padding-bottom: 20px;
        }

        .product img {
          width: 100%;
          height: 290px;
          object-fit: cover;
          background: #e8e0d2;
        }

        .product-info { padding: 17px; }

        .product-info h3 {
          font: 23px Georgia, serif;
          margin: 5px 0 8px;
        }

        .muted {
          color: #201d18;
          font-size: 12px;
          line-height: 1.7;
        }

        .price {
          font-weight: bold;
          margin: 12px 0;
        }

        .product button {
          width: 100%;
          padding: 13px;
          border: 1px solid #b99a57;
          background: #201d18;
          color: #fff;
          cursor: pointer;
          letter-spacing: 1px;
          font-size: 11px;
        }

        .product button:disabled {
          background: #201d18;
          color: #d5b66c;
          cursor: not-allowed;
        }

        .details {
          background: #eee7d9;
          padding: 14px;
          margin: 12px 0;
          font-size: 12px;
          line-height: 1.8;
        }

        .about {
          background: #201d18;
          color: #f5eddb;
          text-align: center;
          padding: 75px 12%;
        }

        .about h2 { font: 36px Georgia, serif; }

        .about p {
          color: #d4cabb;
          line-height: 1.9;
          font-size: 14px;
        }

        .contact {
          max-width: 650px;
          margin: auto;
          text-align: center;
        }

        .contact textarea {
          width: 100%;
          min-height: 110px;
          padding: 15px;
          border: 1px solid #c8bda9;
          background: white;
          color: #171612;
          font: 14px Arial;
          resize: vertical;
        }

        .contact textarea::placeholder {
          color: #171612;
          opacity: 1;
        }

        .cart-box {
          background: white;
          padding: 25px;
          max-width: 650px;
          margin: 30px auto 0;
        }

        .checkout-input {
          width: 100%;
          padding: 14px;
          margin: 8px 0 15px;
          border: 1px solid #c8bda9;
          background: #fffdf8;
          font: 14px Arial;
          color: #171612;
        }

        .checkout-input::placeholder {
          color: #171612;
          opacity: 1;
        }

        .checkout-label {
          display: block;
          font-size: 12px;
          font-weight: bold;
          margin-top: 10px;
        }

        .checkout-button {
          width: 100%;
          padding: 16px;
          margin-top: 15px;
          border: none;
          background: #c5a45d;
          color: #171612;
          cursor: pointer;
          font-weight: bold;
          letter-spacing: 1px;
        }

        .checkout-button:disabled {
          background: #201d18;
          color: #d5b66c;
          cursor: not-allowed;
        }

        .payment-message {
          padding: 16px;
          margin: 15px 0;
          border: 1px solid #c5a45d;
          background: #fffdf8;
          line-height: 1.7;
          font-size: 13px;
        }

        .tracking-result {
          background: #fffdf8;
          border: 1px solid #c5a45d;
          padding: 18px;
          margin-top: 18px;
          line-height: 1.9;
          overflow-wrap: anywhere;
        }

        footer {
          background: #171612;
          color: #d5b66c;
          text-align: center;
          padding: 30px 15px;
          font-size: 12px;
          line-height: 2;
        }

        .empty-products {
          text-align: center;
          background: white;
          padding: 45px 20px;
          line-height: 1.8;
        }

        @media(max-width: 750px) {
          header {
            justify-content: center;
            text-align: center;
          }

          nav {
            justify-content: center;
            gap: 15px;
          }

          .hero {
            min-height: 420px;
            padding: 55px 7%;
          }

          .hero h1 { font-size: 40px; }

          .products { grid-template-columns: 1fr; }

          .product img { height: 320px; }

          .section { padding: 55px 6%; }

          .search-container {
            margin-bottom: 30px;
          }
        }

        .store, .store * {
          color: #000000 !important;
        }

        .contact textarea,
        .checkout-input {
          color: #000000;
        }

        .contact textarea::placeholder,
        .checkout-input::placeholder {
          color: #000000;
          opacity: 1;
        }

        .product-search {
          color: #171612 !important;
        }

        .product-search::placeholder {
          color: #777064 !important;
        }

        .search-icon {
          color: #a17f39 !important;
        }

        .clear-search {
          color: #6d6049 !important;
        }

        /* Fixed mobile navigation */
        .mobile-bottom-nav {
          display: none;
        }

        @media (max-width: 750px) {
          .mobile-bottom-nav {
            display: flex;
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 9999;
            justify-content: space-around;
            align-items: center;
            padding: 10px 5px calc(10px + env(safe-area-inset-bottom));
            background: #171612;
            border-top: 1px solid #c5a45d;
            box-shadow: 0 -3px 15px rgba(0, 0, 0, 0.18);
          }

          .mobile-bottom-nav a {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            color: #f5eddb !important;
            text-decoration: none;
            font-size: 11px;
            line-height: 1.2;
          }

          .mobile-bottom-nav .nav-icon {
            color: #d5b66c !important;
            font-size: 19px;
            line-height: 1;
          }

          .store {
            padding-bottom: 78px;
          }
        }
      `}</style>

      <div className="topbar">
        A WORLD OF BEAUTIFUL FRAGRANCES · BROWNES FRAGRANCE
      </div>

      <header>
        <div className="brand">
          BROWNES
          <small>FRAGRANCE</small>
        </div>

        <nav>
          <a href="#home">Home</a>
          <a href="#shop">Shop</a>
          <a href="#about">Our Story</a>
          <a href="#track">Track Order</a>
          <a href="#contact">Contact</a>
          <a href="#cart" className="cart-count">
            Bag ({cart.length})
          </a>
          <a href="/admin" className="admin-link">
            ADMIN LOGIN
          </a>
        </nav>
      </header>

      {paymentMessage && (
        <div
          className="payment-message"
          role="status"
          style={{ textAlign: "center" }}
        >
          {verifyingPayment ? "PLEASE WAIT: " : ""}
          {paymentMessage}
          {paymentSuccess && confirmedOrderId && (
            <p style={{ marginBottom: 0, overflowWrap: "anywhere" }}>
              <strong>Your Order ID:</strong> {confirmedOrderId}
              <br />
              Keep this ID and your phone number to track your order.
            </p>
          )}
        </div>
      )}

      <section className="hero" id="home">
        <div className="hero-content">
          <div className="eyebrow">THE ART OF FRAGRANCE</div>
          <h1>Make Every Entrance Unforgettable.</h1>
          <p>
            Discover fragrances that express your personality,
            elevate your presence and leave a lasting impression.
          </p>
          <a href="#shop" className="gold-button">
            EXPLORE OUR COLLECTION
          </a>
        </div>
      </section>

      <section className="section" id="shop">
        <div className="section-heading">
          <small>DISCOVER YOUR SIGNATURE SCENT</small>
          <h2>Our Fragrance Collection</h2>
          <p className="muted">Find a fragrance that speaks for you.</p>
        </div>

        <div className="filters">
          {["All", "Men", "Women", "Unisex"].map((item) => (
            <button
              key={item}
              className={`filter ${category === item ? "active" : ""}`}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>

        {/* Search perfumes */}
        <div className="search-container">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            className="product-search"
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by perfume name, brand or scent..."
            aria-label="Search perfumes"
          />
          {searchTerm && (
            <button
              className="clear-search"
              type="button"
              onClick={() => setSearchTerm("")}
              aria-label="Clear search"
            >
              CLEAR ✕
            </button>
          )}
        </div>

        {!loading && !loadError && (
          <p className="search-count">
            {searchTerm.trim()
              ? `${visibleProducts.length} fragrance${visibleProducts.length === 1 ? "" : "s"} found`
              : `${visibleProducts.length} fragrance${visibleProducts.length === 1 ? "" : "s"} available`}
          </p>
        )}

        {loading ? (
          <div className="empty-products">
            <h3>Loading our fragrances...</h3>
          </div>
        ) : loadError ? (
          <div className="empty-products">
            <h3>{loadError}</h3>
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="empty-products">
            <h3>
              {searchTerm.trim()
                ? "No matching fragrances found."
                : "No fragrances available yet."}
            </h3>
            <p className="muted">
              {searchTerm.trim()
                ? "Try another perfume name, brand or fragrance note."
                : "Please check back soon for our latest collection."}
            </p>
            {searchTerm.trim() && (
              <button
                className="gold-button"
                onClick={() => {
                  setSearchTerm("");
                  setCategory("All");
                }}
              >
                VIEW ALL FRAGRANCES
              </button>
            )}
          </div>
        ) : (
          <div className="products">
            {visibleProducts.map((product) => {
              const notes = [
                product.topNotes,
                product.middleNotes,
                product.baseNotes,
              ]
                .filter(Boolean)
                .join(", ");

              const stock = Number(product.stock || 0);

              return (
                <div className="product" key={product.id}>
                  {product.image ? (
                    <img src={product.image} alt={product.name} />
                  ) : (
                    <div
                      style={{
                        height: "290px",
                        display: "grid",
                        placeItems: "center",
                        background: "#e8e0d2",
                      }}
                    >
                      BROWNES FRAGRANCE
                    </div>
                  )}

                  <div className="product-info">
                    <div className="muted">
                      {product.brand} · {product.category} · {product.size}
                    </div>

                    <h3>{product.name}</h3>

                    <p className="muted">
                      {product.description ||
                        "Discover this beautiful fragrance from Brownes Fragrance."}
                    </p>

                    <div className="details">
                      <strong>Concentration:</strong>{" "}
                      {product.concentration || "Not specified"}
                      <br />

                      {notes && (
                        <>
                          <strong>Fragrance notes:</strong> {notes}
                          <br />
                        </>
                      )}

                      {product.longevity && (
                        <>
                          <strong>Longevity:</strong> {product.longevity}
                          <br />
                        </>
                      )}

                      {product.occasion && (
                        <>
                          <strong>Suitable occasion:</strong>{" "}
                          {product.occasion}
                          <br />
                        </>
                      )}

                      <strong>Size:</strong> {product.size}
                      <br />

                      <strong>Availability:</strong>{" "}
                      {stock > 0 ? "In stock" : "Out of stock"}
                    </div>

                    <div className="price">
                      GH₵ {Number(product.price).toFixed(2)}
                    </div>

                    <button
                      onClick={() => addToCart(product)}
                      disabled={stock <= 0}
                    >
                      {stock > 0 ? "ADD TO SHOPPING BAG" : "OUT OF STOCK"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="about" id="about">
        <div className="eyebrow">THE BROWNES EXPERIENCE</div>
        <h2>More Than Just a Fragrance.</h2>
        <p>
          At Brownes Fragrance, we believe the right scent is more than
          a finishing touch. It is an expression of identity, confidence
          and individuality. Discover your next signature fragrance with us.
        </p>
      </section>

      <section className="section" id="track">
        <div className="section-heading">
          <small>FOLLOW YOUR PURCHASE</small>
          <h2>Track Your Order</h2>
          <p className="muted">
            Enter the Order ID and phone number used during checkout to see your order status.
          </p>
        </div>

        <div className="cart-box">
          <label className="checkout-label">Order ID</label>
          <input
            className="checkout-input"
            type="text"
            value={trackingOrderId}
            onChange={(event) => setTrackingOrderId(event.target.value)}
            placeholder="Enter your Order ID"
          />

          <label className="checkout-label">Phone number used at checkout</label>
          <input
            className="checkout-input"
            type="tel"
            value={trackingPhone}
            onChange={(event) => setTrackingPhone(event.target.value)}
            placeholder="Enter your phone number"
            autoComplete="tel"
          />

          <button
            className="checkout-button"
            onClick={trackOrder}
            disabled={trackingLoading}
          >
            {trackingLoading ? "CHECKING ORDER..." : "TRACK MY ORDER"}
          </button>

          {trackingMessage && (
            <div className="tracking-result" role="status">
              {trackingMessage}
            </div>
          )}

          {trackingResult && (
            <div className="tracking-result">
              <h3 style={{ marginTop: 0 }}>Order Details</h3>
              <p>
                <strong>Order ID:</strong> {trackingResult.id}
              </p>
              <p>
                <strong>Order status:</strong> {trackingResult.status}
              </p>
              <p>
                <strong>Payment status:</strong> {trackingResult.payment_status}
              </p>
              <p>
                <strong>Order total:</strong> GH₵ {Number(trackingResult.total).toFixed(2)}
              </p>
              <p>
                <strong>Date placed:</strong>{" "}
                {trackingResult.created_at
                  ? new Date(trackingResult.created_at).toLocaleString()
                  : "Not available"}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="section" id="cart">
        <div className="section-heading">
          <small>YOUR SELECTION</small>
          <h2>Shopping Bag ({cart.length})</h2>
        </div>

        <div className="cart-box">
          {cart.length === 0 ? (
            <p className="muted">
              Your shopping bag is currently empty.
            </p>
          ) : (
            <>
              {cart.map((item, index) => (
                <p key={`${item.id}-${index}`}>
                  {item.name} — GH₵ {Number(item.price).toFixed(2)}

                  <button
                    style={{
                      marginLeft: 12,
                      border: 0,
                      cursor: "pointer",
                      background: "transparent",
                    }}
                    onClick={() =>
                      setCart((previous) =>
                        previous.filter((_, i) => i !== index)
                      )
                    }
                  >
                    Remove
                  </button>
                </p>
              ))}

              <h3>Total: GH₵ {total.toFixed(2)}</h3>

              <div className="details">
                <strong>DELIVERY AND PAYMENT INFORMATION</strong>

                <p className="muted">
                  Enter your details below. You will proceed to Paystack
                  to complete your payment securely.
                </p>

                <label className="checkout-label">Full name *</label>
                <input
                  className="checkout-input"
                  type="text"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="Enter your full name"
                  autoComplete="name"
                />

                <label className="checkout-label">Phone number *</label>
                <input
                  className="checkout-input"
                  type="tel"
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  placeholder="Enter your phone number"
                  autoComplete="tel"
                />

                <label className="checkout-label">
                  Email address (optional)
                </label>
                <input
                  className="checkout-input"
                  type="email"
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  placeholder="Enter your email address (optional)"
                  autoComplete="email"
                />

                <label className="checkout-label">Delivery address *</label>
                <textarea
                  className="checkout-input"
                  value={deliveryAddress}
                  onChange={(event) => setDeliveryAddress(event.target.value)}
                  placeholder="Enter your delivery address"
                  rows="3"
                />

                <label className="checkout-label">
                  Additional delivery notes (optional)
                </label>
                <textarea
                  className="checkout-input"
                  value={deliveryNotes}
                  onChange={(event) => setDeliveryNotes(event.target.value)}
                  placeholder="Any directions or extra information?"
                  rows="2"
                />
              </div>

              <button
                className="checkout-button"
                onClick={placeOrder}
                disabled={placingOrder || verifyingPayment}
              >
                {placingOrder
                  ? "PREPARING PAYMENT..."
                  : "PROCEED TO SECURE PAYMENT"}
              </button>

              <p className="muted">
                Your payment will be processed securely by Paystack.
                Your order is confirmed after successful payment verification.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="section" id="contact">
        <div className="contact">
          <div className="section-heading">
            <small>WE ARE HERE TO HELP</small>
            <h2>Ask Brownes</h2>
            <p className="muted">
              Have questions about a fragrance, its notes, availability
              or recommendations? Send us a message.
            </p>
          </div>

          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Hello Brownes, I would like to know more about..."
          />

          <button className="gold-button" onClick={sendQuestion}>
            SEND YOUR QUESTION ON WHATSAPP
          </button>

          <p className="muted">WhatsApp: +233 20 251 1522</p>
        </div>
      </section>

      <footer>
        <div className="brand">BROWNES</div>
        FRAGRANCE
        <p>Buy. Experience. Repeat.</p>
        <p>© 2026 Brownes Fragrance. All rights reserved.</p>
      </footer>

      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        <a href="#home">
          <span className="nav-icon" aria-hidden="true">⌂</span>
          <span>Home</span>
        </a>
        <a href="#shop">
          <span className="nav-icon" aria-hidden="true">◇</span>
          <span>Shop</span>
        </a>
        <a href="#cart">
          <span className="nav-icon" aria-hidden="true">▣</span>
          <span>Cart ({cart.length})</span>
        </a>
        <a href="#track">
          <span className="nav-icon" aria-hidden="true">◎</span>
          <span>Track Order</span>
        </a>
      </nav>
    </div>
  );
}

export default function App() {
  if (
    window.location.pathname === "/admin" ||
    window.location.pathname === "/admin/"
  ) {
    return <Admin />;
  }

  return <Storefront />;
}
