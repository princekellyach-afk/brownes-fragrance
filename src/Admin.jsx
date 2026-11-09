import { useEffect, useState } from "react";
import { supabase } from "./supabase";

const initialForm = {
  name: "", brand: "", category: "Men", price: "", size: "100ml",
  stock: "", concentration: "EDP", longevity: "", occasion: "",
  topNotes: "", middleNotes: "", baseNotes: "", description: "",
};

const inputStyle = {
  width: "100%", padding: "12px", border: "1px solid #ddd3c2",
  borderRadius: "5px", background: "#fffdf8", color: "#000000",
  boxSizing: "border-box", fontSize: "14px", marginTop: "7px",
  fontFamily: "Arial, sans-serif",
};

function Field({ label, name, form, updateField, type = "text", placeholder }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      <input
        style={inputStyle}
        name={name}
        type={type}
        value={form[name]}
        onChange={updateField}
        placeholder={placeholder}
        required={["name", "brand", "price"].includes(name)}
        min={type === "number" ? "0" : undefined}
        step={name === "price" ? "0.01" : "1"}
      />
    </div>
  );
}

function TextField({ label, name, form, updateField }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      <textarea
        style={{ ...inputStyle, minHeight: "85px", resize: "vertical" }}
        name={name}
        value={form[name]}
        onChange={updateField}
        placeholder={`Enter ${label.toLowerCase()}`}
      />
    </div>
  );
}

function formatProduct(product) {
  return {
    ...product,
    topNotes: product.top_notes || "",
    middleNotes: product.middle_notes || "",
    baseNotes: product.base_notes || "",
    image: product.image_url || "",
  };
}

async function uploadImage(file, userId) {
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "-");
  const filePath = `${userId}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(filePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) throw error;

  return supabase.storage
    .from("product-images")
    .getPublicUrl(filePath).data.publicUrl;
}

async function migrateOldProducts(userId) {
  const oldProducts = JSON.parse(
    localStorage.getItem("brownesProducts") || "[]"
  );

  if (!Array.isArray(oldProducts) || oldProducts.length === 0) {
    return false;
  }

  for (const product of oldProducts) {
    let imageUrl = product.image || "";

    if (imageUrl.startsWith("data:")) {
      const response = await fetch(imageUrl);
      const blob = await response.blob();

      imageUrl = await uploadImage(
        new File([blob], `old-product-${Date.now()}.jpg`, {
          type: blob.type || "image/jpeg",
        }),
        userId
      );
    }

    const { error } = await supabase.from("products").insert({
      name: product.name,
      brand: product.brand,
      category: product.category,
      price: Number(product.price),
      size: product.size,
      stock: Number(product.stock || 0),
      concentration: product.concentration,
      longevity: product.longevity,
      occasion: product.occasion,
      top_notes: product.topNotes || "",
      middle_notes: product.middleNotes || "",
      base_notes: product.baseNotes || "",
      description: product.description || "",
      image_url: imageUrl,
    });

    if (error) throw error;
  }

  return true;
}

// Only verified paid orders count as sales.
function calculateSales(orders) {
  const successfulOrders = orders.filter((order) =>
    order.payment_status === "Paid" &&
    ["Confirmed", "Processing", "Dispatched", "Delivered"].includes(order.status)
  );

  const now = new Date();
  const todayKey = now.toLocaleDateString("en-CA");

  const todayOrders = successfulOrders.filter(
    (order) =>
      new Date(order.created_at).toLocaleDateString("en-CA") === todayKey
  );

  const monthlyOrders = successfulOrders.filter((order) => {
    const date = new Date(order.created_at);
    return (
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()
    );
  });

  const revenue = (list) =>
    list.reduce((sum, order) => sum + Number(order.total || 0), 0);

  const products = {};

  successfulOrders.forEach((order) => {
    (Array.isArray(order.items) ? order.items : []).forEach((item) => {
      const name = item.name || "Unknown Product";

      if (!products[name]) {
        products[name] = {
          name,
          brand: item.brand || "",
          quantity: 0,
          revenue: 0,
        };
      }

      const quantity = Number(item.quantity || 1);
      products[name].quantity += quantity;
      products[name].revenue += Number(item.price || 0) * quantity;
    });
  });

  return {
    successfulOrders,
    totalRevenue: revenue(successfulOrders),
    todayRevenue: revenue(todayOrders),
    monthlyRevenue: revenue(monthlyOrders),
    totalSales: successfulOrders.length,
    bestSellers: Object.values(products).sort(
      (a, b) => b.quantity - a.quantity
    ),
  };
}

function money(value) {
  return `GH₵${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function Admin() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [currentImage, setCurrentImage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const menuItems = [
    "Dashboard", "Products", "Orders", "Customers", "Sales", "Settings",
  ];

  const sales = calculateSales(orders);

  async function loadProducts(userId) {
    setError("");

    try {
      let { data, error: fetchError } = await supabase
        .from("products")
        .select("*")
        .order("created_at", { ascending: false });

      if (fetchError) throw fetchError;

      if (data.length === 0) {
        const migrated = await migrateOldProducts(userId);

        if (migrated) {
          const result = await supabase
            .from("products")
            .select("*")
            .order("created_at", { ascending: false });

          if (result.error) throw result.error;
          data = result.data;
        }
      }

      setProducts((data || []).map(formatProduct));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadOrders() {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setOrders(data || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    async function checkLogin() {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) throw error;

        const currentUser = data.session?.user || null;
        setUser(currentUser);

        if (currentUser) {
          await Promise.all([
            loadProducts(currentUser.id),
            loadOrders(),
          ]);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    checkLogin();
  }, []);

  async function login(event) {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      setUser(data.user);

      await Promise.all([
        loadProducts(data.user.id),
        loadOrders(),
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setError(error.message);
      return;
    }

    setUser(null);
    setProducts([]);
    setOrders([]);
    setActiveTab("Dashboard");
  }

  function updateField(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  function handleImage(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("Please choose an image smaller than 5MB.");
      event.target.value = "";
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function openAddForm() {
    setEditingId(null);
    setForm(initialForm);
    setImageFile(null);
    setImagePreview("");
    setCurrentImage("");
    setShowForm(true);
  }

  function openEditForm(product) {
    setEditingId(product.id);

    setForm({
      name: product.name || "",
      brand: product.brand || "",
      category: product.category || "Men",
      price: String(product.price ?? ""),
      size: product.size || "100ml",
      stock: String(product.stock ?? ""),
      concentration: product.concentration || "EDP",
      longevity: product.longevity || "",
      occasion: product.occasion || "",
      topNotes: product.topNotes || "",
      middleNotes: product.middleNotes || "",
      baseNotes: product.baseNotes || "",
      description: product.description || "",
    });

    setCurrentImage(product.image || "");
    setImageFile(null);
    setImagePreview(product.image || "");
    setShowForm(true);
  }

  async function saveProduct(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      let imageUrl = currentImage;

      if (imageFile) {
        imageUrl = await uploadImage(imageFile, user.id);
      }

      const productData = {
        name: form.name.trim(),
        brand: form.brand.trim(),
        category: form.category,
        price: Number(form.price),
        size: form.size,
        stock: Number(form.stock || 0),
        concentration: form.concentration,
        longevity: form.longevity,
        occasion: form.occasion,
        top_notes: form.topNotes,
        middle_notes: form.middleNotes,
        base_notes: form.baseNotes,
        description: form.description,
        image_url: imageUrl,
      };

      if (editingId) {
        const { error } = await supabase
          .from("products")
          .update(productData)
          .eq("id", editingId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("products")
          .insert(productData);

        if (error) throw error;
      }

      await loadProducts(user.id);

      setForm(initialForm);
      setImageFile(null);
      setImagePreview("");
      setCurrentImage("");
      setEditingId(null);
      setShowForm(false);

      alert(
        editingId
          ? "Perfume updated successfully!"
          : "Perfume saved online!"
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(id) {
    if (!window.confirm("Are you sure you want to delete this perfume?")) {
      return;
    }

    setError("");

    try {
      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", id);

      if (error) throw error;

      await loadProducts(user.id);
    } catch (err) {
      setError(err.message);
    }
  }

  // Protect orders from being confirmed before payment is verified.
  async function updateOrderStatus(orderId, newStatus) {
    try {
      setError("");

      const selectedOrder = orders.find(
        (order) => order.id === orderId
      );

      if (!selectedOrder) {
        throw new Error("Order could not be found.");
      }

      const requiresPayment = [
        "Confirmed",
        "Processing",
        "Dispatched",
        "Delivered",
      ].includes(newStatus);

      if (
        requiresPayment &&
        selectedOrder.payment_status !== "Paid"
      ) {
        setError(
          "This order cannot be confirmed because payment has not been verified."
        );
        return;
      }

      const { error } = await supabase
        .from("orders")
        .update({ status: newStatus })
        .eq("id", orderId);

      if (error) throw error;

      await loadOrders();
    } catch (err) {
      setError(err.message);
    }
  }

  function formatDate(date) {
    return new Date(date).toLocaleString("en-GH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  if (loading) {
    return (
      <div style={styles.loginPage}>
        Loading Brownes Fragrance...
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.loginPage}>
        <form onSubmit={login} style={styles.loginCard}>
          <h1 style={styles.loginLogo}>BROWNES</h1>
          <p style={styles.loginSub}>FRAGRANCE ADMIN</p>

          <h2 style={{ color: "#000000" }}>
            Administrator Login
          </h2>

          <p style={styles.smallText}>
            Sign in to manage your fragrance store.
          </p>

          {error && <p style={styles.error}>{error}</p>}

          <label style={styles.label}>Email Address</label>
          <input
            style={inputStyle}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Your admin email"
            required
          />

          <label style={styles.label}>Password</label>
          <input
            style={inputStyle}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            required
          />

          <button style={styles.goldButton} disabled={saving}>
            {saving ? "Signing in..." : "Sign In"}
          </button>

          <p style={{ textAlign: "center", marginTop: 20 }}>
            <a href="/" style={styles.storeLink}>
              ← Back to Store
            </a>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <aside style={styles.sidebar}>
        <h2 style={styles.logo}>BROWNES</h2>
        <p style={styles.logoSub}>FRAGRANCE ADMIN</p>

        <nav>
          {menuItems.map((item) => (
            <button
              key={item}
              onClick={() => {
                setActiveTab(item);
                setShowForm(false);

                if (["Orders", "Sales", "Customers"].includes(item)) {
                  loadOrders();
                }
              }}
              style={{
                ...styles.menuButton,
                background:
                  activeTab === item ? "#c49a45" : "transparent",
                color:
                  activeTab === item ? "#111111" : "#ffffff",
              }}
            >
              {item}
              {item === "Orders" && orders.length > 0
                ? ` (${orders.length})`
                : ""}
            </button>
          ))}
        </nav>

        <button style={styles.logoutButton} onClick={logout}>
          Sign Out
        </button>

        <p style={styles.sidebarBottom}>
          Luxury in every drop.
        </p>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <div>
            <p style={styles.smallText}>
              BROWNES FRAGRANCE / ADMIN
            </p>
            <h1 style={styles.heading}>{activeTab}</h1>
          </div>

          <div style={styles.headerActions}>
            <a href="/" style={styles.backToStore}>
              ← BACK TO STORE
            </a>
            <div style={styles.adminLabel}>Administrator</div>
          </div>
        </header>

        {error && <p style={styles.error}>{error}</p>}

        {/* DASHBOARD */}
        {activeTab === "Dashboard" && (
          <>
            <h2 style={styles.sectionTitle}>Store overview</h2>

            <div style={styles.stats}>
              {[
                ["Total Products", products.length],
                ["Total Orders", orders.length],
                [
                  "Pending Orders",
                  orders.filter((o) => o.status === "Pending").length,
                ],
                [
                  "Delivered Orders",
                  orders.filter((o) => o.status === "Delivered").length,
                ],
              ].map(([label, value]) => (
                <div key={label} style={styles.statCard}>
                  <p style={styles.smallText}>{label}</p>
                  <h2 style={styles.statValue}>{value}</h2>
                </div>
              ))}
            </div>

            {/* REVENUE OVERVIEW */}
            <h2 style={styles.sectionTitle}>Revenue overview</h2>

            <div style={styles.stats}>
              {[
                ["Total Revenue", money(sales.totalRevenue)],
                ["Today's Revenue", money(sales.todayRevenue)],
                ["Monthly Revenue", money(sales.monthlyRevenue)],
                ["Successful Paid Orders", sales.totalSales],
              ].map(([label, value]) => (
                <div key={label} style={styles.statCard}>
                  <p style={styles.smallText}>{label}</p>
                  <h2 style={styles.salesValue}>{value}</h2>
                </div>
              ))}
            </div>

            <div style={styles.welcomeCard}>
              <p style={styles.goldText}>WELCOME TO YOUR STORE</p>

              <h2 style={{ color: "#000000" }}>
                Manage your fragrance business.
              </h2>

              <p>
                Your perfumes and customer orders are connected to your
                online database.
              </p>

              <button
                style={styles.goldButton}
                onClick={() => setActiveTab("Products")}
              >
                Manage Products
              </button>

              <button
                style={{ ...styles.goldButton, marginLeft: 10 }}
                onClick={() => setActiveTab("Sales")}
              >
                View Sales
              </button>
            </div>
          </>
        )}

        {/* PRODUCTS */}
        {activeTab === "Products" && (
          <>
            <div style={styles.productHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Your fragrances</h2>
                <p style={styles.smallText}>
                  You currently have {products.length} products online.
                </p>
              </div>

              <button
                style={styles.goldButton}
                onClick={openAddForm}
              >
                + Add New Perfume
              </button>
            </div>

            {showForm && (
              <form onSubmit={saveProduct} style={styles.formCard}>
                <p style={styles.goldText}>PRODUCT INFORMATION</p>

                <h2 style={{ color: "#000000" }}>
                  {editingId ? "Edit fragrance" : "Add a new fragrance"}
                </h2>

                <div style={styles.formGrid}>
                  <Field
                    label="Perfume Name *"
                    name="name"
                    form={form}
                    updateField={updateField}
                    placeholder="e.g. Oud Royale"
                  />

                  <Field
                    label="Brand *"
                    name="brand"
                    form={form}
                    updateField={updateField}
                    placeholder="e.g. Lattafa"
                  />

                  <Field
                    label="Selling Price (GH₵) *"
                    name="price"
                    type="number"
                    form={form}
                    updateField={updateField}
                    placeholder="250"
                  />

                  <div style={styles.field}>
                    <label style={styles.label}>Category</label>
                    <select
                      style={inputStyle}
                      name="category"
                      value={form.category}
                      onChange={updateField}
                    >
                      <option>Men</option>
                      <option>Women</option>
                      <option>Unisex</option>
                    </select>
                  </div>

                  <div style={styles.field}>
                    <label style={styles.label}>Bottle Size</label>
                    <select
                      style={inputStyle}
                      name="size"
                      value={form.size}
                      onChange={updateField}
                    >
                      {[
                        "30ml", "50ml", "75ml", "100ml",
                        "125ml", "200ml",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>

                  <Field
                    label="Available Stock"
                    name="stock"
                    type="number"
                    form={form}
                    updateField={updateField}
                    placeholder="10"
                  />

                  <div style={styles.field}>
                    <label style={styles.label}>Concentration</label>
                    <select
                      style={inputStyle}
                      name="concentration"
                      value={form.concentration}
                      onChange={updateField}
                    >
                      {[
                        "EDP", "EDT", "EDC", "Extrait de Parfum",
                        "Parfum", "Body Mist",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>

                  <Field
                    label="Longevity"
                    name="longevity"
                    form={form}
                    updateField={updateField}
                    placeholder="e.g. 8–10 hours"
                  />

                  <Field
                    label="Suitable Occasion"
                    name="occasion"
                    form={form}
                    updateField={updateField}
                    placeholder="e.g. Evening, office"
                  />
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>Product Picture</label>
                  <input
                    style={inputStyle}
                    type="file"
                    accept="image/*"
                    onChange={handleImage}
                  />

                  {imagePreview && (
                    <img
                      src={imagePreview}
                      alt="Perfume preview"
                      style={styles.preview}
                    />
                  )}
                </div>

                <TextField
                  label="Top Notes"
                  name="topNotes"
                  form={form}
                  updateField={updateField}
                />

                <TextField
                  label="Middle Notes"
                  name="middleNotes"
                  form={form}
                  updateField={updateField}
                />

                <TextField
                  label="Base Notes"
                  name="baseNotes"
                  form={form}
                  updateField={updateField}
                />

                <TextField
                  label="Product Description"
                  name="description"
                  form={form}
                  updateField={updateField}
                />

                <button
                  type="submit"
                  style={styles.goldButton}
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : editingId
                      ? "Update Perfume"
                      : "Save Perfume"}
                </button>

                <button
                  type="button"
                  style={styles.cancelButton}
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              </form>
            )}

            {products.length === 0 ? (
              <div style={styles.emptyCard}>
                <h2>No perfumes added yet.</h2>
                <p>Your online fragrances will appear here.</p>
              </div>
            ) : (
              <div style={styles.productGrid}>
                {products.map((product) => (
                  <div key={product.id} style={styles.productCard}>
                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.name}
                        style={styles.productImage}
                      />
                    ) : (
                      <div style={styles.noImage}>NO IMAGE</div>
                    )}

                    <div style={{ padding: 18 }}>
                      <p style={styles.goldText}>{product.brand}</p>
                      <h3>{product.name}</h3>

                      <p style={styles.smallText}>
                        {product.category} · {product.size} ·{" "}
                        {product.concentration}
                      </p>

                      <h3 style={{ color: "#a77c2c" }}>
                        {money(product.price)}
                      </h3>

                      <p style={styles.smallText}>
                        Stock: {product.stock}
                      </p>

                      <button
                        style={styles.editButton}
                        onClick={() => openEditForm(product)}
                      >
                        Edit Product
                      </button>

                      <button
                        style={styles.deleteButton}
                        onClick={() => deleteProduct(product.id)}
                      >
                        Delete Product
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ORDERS */}
        {activeTab === "Orders" && (
          <>
            <div style={styles.productHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Customer Orders</h2>
                <p style={styles.smallText}>
                  You have received {orders.length} orders.
                </p>
              </div>

              <button
                style={styles.goldButton}
                onClick={loadOrders}
              >
                Refresh Orders
              </button>
            </div>

            {orders.length === 0 ? (
              <div style={styles.emptyCard}>
                <h2>No orders yet.</h2>
                <p>
                  Customer orders will appear here when they purchase
                  from your shop.
                </p>
              </div>
            ) : (
              <div style={styles.ordersList}>
                {orders.map((order) => {
                  const isPaid = order.payment_status === "Paid";

                  return (
                    <div key={order.id} style={styles.orderCard}>
                      <div style={styles.orderTop}>
                        <div>
                          <p style={styles.goldText}>
                            ORDER #{order.id.slice(0, 8).toUpperCase()}
                          </p>

                          <h2 style={styles.orderName}>
                            {order.customer_name}
                          </h2>

                          <p style={styles.smallText}>
                            {formatDate(order.created_at)}
                          </p>
                        </div>

                        <div style={styles.badgeGroup}>
                          <span
                            style={{
                              ...styles.statusBadge,
                              background:
                                order.status === "Delivered"
                                  ? "#dcebdc"
                                  : order.status === "Cancelled"
                                    ? "#f5dddd"
                                    : "#eee4cf",
                              color:
                                order.status === "Delivered"
                                  ? "#28633a"
                                  : order.status === "Cancelled"
                                    ? "#9b3030"
                                    : "#76551e",
                            }}
                          >
                            {order.status}
                          </span>

                          <span
                            style={{
                              ...styles.statusBadge,
                              background: isPaid ? "#dcebdc" : "#f5dddd",
                              color: isPaid ? "#28633a" : "#9b3030",
                            }}
                          >
                            Payment: {isPaid ? "PAID" : "UNPAID"}
                          </span>
                        </div>
                      </div>

                      <div style={styles.orderDetails}>
                        <p>
                          <strong>Phone:</strong> {order.customer_phone}
                        </p>

                        {order.customer_email && (
                          <p>
                            <strong>Email:</strong> {order.customer_email}
                          </p>
                        )}

                        <p>
                          <strong>Delivery Address:</strong>{" "}
                          {order.delivery_address}
                        </p>

                        {order.delivery_notes && (
                          <p>
                            <strong>Delivery Notes:</strong>{" "}
                            {order.delivery_notes}
                          </p>
                        )}

                        <p>
                          <strong>Payment Reference:</strong>{" "}
                          {order.payment_reference || "Not available"}
                        </p>
                      </div>

                      <div style={styles.orderItems}>
                        <h3>Items Ordered</h3>

                        {Array.isArray(order.items) &&
                          order.items.map((item, index) => (
                            <div key={index} style={styles.orderItem}>
                              <div>
                                <strong>{item.name}</strong>
                                <p style={styles.smallText}>
                                  {item.brand || ""} · {item.size || ""} ·
                                  Quantity: {item.quantity || 1}
                                </p>
                              </div>

                              <strong>
                                {money(
                                  Number(item.price || 0) *
                                  Number(item.quantity || 1)
                                )}
                              </strong>
                            </div>
                          ))}
                      </div>

                      <div style={styles.orderBottom}>
                        <div>
                          <h3 style={styles.orderTotal}>
                            Total: {money(order.total)}
                          </h3>

                          <p style={styles.paymentText}>
                            Payment status:{" "}
                            <strong>{isPaid ? "Paid" : "Unpaid"}</strong>
                          </p>
                        </div>

                        <div style={styles.statusControl}>
                          <label style={styles.label}>
                            Update Order Status
                          </label>

                          <select
                            style={inputStyle}
                            value={order.status}
                            onChange={(e) =>
                              updateOrderStatus(order.id, e.target.value)
                            }
                          >
                            <option value="Pending">Pending</option>
                            <option value="Confirmed" disabled={!isPaid}>
                              Confirmed {!isPaid ? "(Payment required)" : ""}
                            </option>
                            <option value="Processing" disabled={!isPaid}>
                              Processing {!isPaid ? "(Payment required)" : ""}
                            </option>
                            <option value="Dispatched" disabled={!isPaid}>
                              Dispatched {!isPaid ? "(Payment required)" : ""}
                            </option>
                            <option value="Delivered" disabled={!isPaid}>
                              Delivered {!isPaid ? "(Payment required)" : ""}
                            </option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* SALES */}
        {activeTab === "Sales" && (
          <>
            <div style={styles.productHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Sales performance</h2>
                <p style={styles.smallText}>
                  Revenue from verified paid orders only.
                </p>
              </div>

              <button
                style={styles.goldButton}
                onClick={loadOrders}
              >
                Refresh Sales
              </button>
            </div>

            <div style={styles.stats}>
              {[
                ["Total Revenue", money(sales.totalRevenue)],
                ["Today's Revenue", money(sales.todayRevenue)],
                ["This Month", money(sales.monthlyRevenue)],
                ["Successful Orders", sales.totalSales],
              ].map(([label, value]) => (
                <div key={label} style={styles.statCard}>
                  <p style={styles.smallText}>{label}</p>
                  <h2 style={styles.salesValue}>{value}</h2>
                </div>
              ))}
            </div>

            <div style={styles.salesPanel}>
              <p style={styles.goldText}>PRODUCT PERFORMANCE</p>
              <h2 style={{ color: "#000000" }}>
                Best-selling perfumes
              </h2>

              {sales.bestSellers.length === 0 ? (
                <p style={{ color: "#000000" }}>
                  No verified paid sales to rank yet.
                </p>
              ) : (
                <div style={styles.salesTable}>
                  <div style={styles.salesTableHead}>
                    <span>Perfume</span>
                    <span>Quantity sold</span>
                    <span>Sales value</span>
                  </div>

                  {sales.bestSellers.map((item) => (
                    <div key={item.name} style={styles.salesTableRow}>
                      <div>
                        <strong>{item.name}</strong>
                        <p style={styles.smallText}>{item.brand}</p>
                      </div>

                      <strong>{item.quantity}</strong>
                      <strong>{money(item.revenue)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={styles.salesPanel}>
              <p style={styles.goldText}>RECENT SALES</p>
              <h2 style={{ color: "#000000" }}>Sales history</h2>

              {sales.successfulOrders.length === 0 ? (
                <p style={{ color: "#000000" }}>
                  No successful sales yet.
                </p>
              ) : (
                <div style={styles.ordersList}>
                  {sales.successfulOrders.slice(0, 10).map((order) => (
                    <div key={order.id} style={styles.historyRow}>
                      <div>
                        <strong>{order.customer_name}</strong>
                        <p style={styles.smallText}>
                          #{order.id.slice(0, 8).toUpperCase()} ·{" "}
                          {formatDate(order.created_at)}
                        </p>
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <strong>{money(order.total)}</strong>
                        <p style={styles.smallText}>{order.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p style={styles.salesNote}>
              Note: Only orders with verified Paystack payments are included.
              Pending, unpaid and cancelled orders are excluded.
            </p>
          </>
        )}

        {/* CUSTOMERS */}
        {activeTab === "Customers" && (
          <>
            <div style={styles.productHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Customers</h2>
                <p style={styles.smallText}>
                  Customer details from submitted orders.
                </p>
              </div>

              <button
                style={styles.goldButton}
                onClick={loadOrders}
              >
                Refresh Customers
              </button>
            </div>

            {orders.length === 0 ? (
              <div style={styles.emptyCard}>
                <h2>No customer records yet.</h2>
              </div>
            ) : (
              <div style={styles.salesPanel}>
                {[
                  ...new Map(
                    orders.map((o) => [o.customer_phone, o])
                  ).values(),
                ].map((customer) => (
                  <div
                    key={customer.customer_phone}
                    style={styles.historyRow}
                  >
                    <div>
                      <strong>{customer.customer_name}</strong>
                      <p style={styles.smallText}>
                        {customer.customer_phone}
                      </p>
                      <p>{customer.delivery_address}</p>
                    </div>

                    <span style={styles.smallText}>
                      {orders.filter(
                        (o) => o.customer_phone === customer.customer_phone
                      ).length}{" "}
                      order(s)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* SETTINGS */}
        {activeTab === "Settings" && (
          <div style={styles.welcomeCard}>
            <p style={styles.goldText}>BROWNES FRAGRANCE</p>
            <h2 style={{ color: "#000000" }}>Store settings</h2>
            <p>
              Your store settings section is ready for its next upgrade.
            </p>
            <p>
              <strong>Store:</strong> Brownes Fragrance
            </p>
            <p>
              <strong>WhatsApp:</strong> +233 20 251 1522
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  loginPage: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    backgroundColor: "#f6f0e4",
    backgroundImage: `linear-gradient(135deg, rgba(255,255,255,.72), rgba(239,228,208,.48), rgba(255,250,240,.72)), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 800'%3E%3Cg fill='none' stroke='%23c49a4a' stroke-width='2' opacity='.38'%3E%3Cpath d='M-80 120 C90 40 120 220 280 145 S470 20 620 120 820 245 980 130 1130 45 1280 100'/%3E%3Cpath d='M-70 138 C95 58 130 238 290 163 S480 38 630 138 830 263 990 148 1140 63 1290 118' stroke-width='1'/%3E%3Cpath d='M-60 620 C110 540 180 700 330 610 S520 490 680 600 850 720 1010 610 1160 520 1300 580'/%3E%3Cpath d='M-55 642 C115 562 185 722 335 632 S525 512 685 622 855 742 1015 632 1165 542 1305 602' stroke-width='1'/%3E%3Cpath d='M760 -40 C690 100 850 160 770 290 S690 450 790 540 910 690 830 850' stroke-width='1.5'/%3E%3C/g%3E%3C/svg%3E")`,
    backgroundSize: "cover, 1200px 800px",
    backgroundAttachment: "fixed",
    padding: 20,
    boxSizing: "border-box",
    fontFamily: "Arial, sans-serif",
    color: "#000000",
  },

  loginCard: {
    background: "#fffdf8",
    color: "#000000",
    padding: 35,
    borderRadius: 10,
    width: "100%",
    maxWidth: 400,
    boxSizing: "border-box",
  },

  loginLogo: {
    color: "#a77c2c",
    letterSpacing: 5,
    textAlign: "center",
    marginBottom: 5,
  },

  loginSub: {
    textAlign: "center",
    letterSpacing: 3,
    fontSize: 10,
    color: "#000000",
    marginBottom: 35,
  },

  container: {
    minHeight: "100vh",
    width: "100%",
    display: "flex",
    backgroundColor: "#f6f0e4",
    backgroundImage: `linear-gradient(135deg, rgba(255,255,255,.72), rgba(239,228,208,.48), rgba(255,250,240,.72)), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 800'%3E%3Cg fill='none' stroke='%23c49a4a' stroke-width='2' opacity='.38'%3E%3Cpath d='M-80 120 C90 40 120 220 280 145 S470 20 620 120 820 245 980 130 1130 45 1280 100'/%3E%3Cpath d='M-70 138 C95 58 130 238 290 163 S480 38 630 138 830 263 990 148 1140 63 1290 118' stroke-width='1'/%3E%3Cpath d='M-60 620 C110 540 180 700 330 610 S520 490 680 600 850 720 1010 610 1160 520 1300 580'/%3E%3Cpath d='M-55 642 C115 562 185 722 335 632 S525 512 685 622 855 742 1015 632 1165 542 1305 602' stroke-width='1'/%3E%3Cpath d='M760 -40 C690 100 850 160 770 290 S690 450 790 540 910 690 830 850' stroke-width='1.5'/%3E%3C/g%3E%3C/svg%3E")`,
    backgroundSize: "cover, 1200px 800px",
    backgroundAttachment: "fixed",
    color: "#000000",
    fontFamily: "Arial, sans-serif",
  },

  sidebar: {
    width: 230,
    background: "#171512",
    color: "#f4efe5",
    padding: "30px 20px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
  },

  logo: {
    color: "#c49a45",
    letterSpacing: 4,
    marginBottom: 4,
  },

  logoSub: {
    fontSize: 10,
    letterSpacing: 3,
    color: "#ffffff",
    marginTop: 0,
    marginBottom: 45,
  },

  menuButton: {
    display: "block",
    width: "100%",
    border: "none",
    borderRadius: 6,
    padding: 14,
    marginBottom: 9,
    textAlign: "left",
    fontSize: 14,
    cursor: "pointer",
  },

  logoutButton: {
    marginTop: 25,
    padding: 12,
    background: "transparent",
    border: "1px solid #c49a45",
    color: "#c49a45",
    borderRadius: 5,
    cursor: "pointer",
  },

  sidebarBottom: {
    marginTop: "auto",
    color: "#c49a45",
    fontSize: 12,
  },

  main: {
    flex: 1,
    padding: 35,
    minWidth: 0,
    color: "#000000",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 15,
    borderBottom: "1px solid #ddd3c2",
    paddingBottom: 22,
    color: "#000000",
  },

  smallText: {
    fontSize: 11,
    color: "#000000",
    letterSpacing: 1.2,
  },

  heading: {
    fontSize: 30,
    margin: "8px 0",
    color: "#000000",
  },

  headerActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 12,
  },

  backToStore: {
    display: "inline-block",
    padding: "12px 16px",
    border: "1px solid #c49a45",
    borderRadius: 5,
    color: "#000000",
    background: "rgba(255,250,240,.82)",
    textDecoration: "none",
    fontSize: 11,
    fontWeight: "bold",
    letterSpacing: 1,
    whiteSpace: "nowrap",
  },

  storeLink: {
    color: "#000000",
    textDecoration: "none",
    fontWeight: "bold",
  },

  adminLabel: {
    background: "#e8dfcf",
    color: "#000000",
    padding: "12px 18px",
    borderRadius: 30,
    fontSize: 12,
  },

  sectionTitle: {
    marginTop: 20,
    fontSize: 19,
    color: "#000000",
  },

  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 18,
    marginTop: 20,
  },

  statCard: {
    background: "#fffdf8",
    color: "#000000",
    padding: 22,
    border: "1px solid #e5dccd",
    borderRadius: 9,
    minWidth: 0,
  },

  statValue: {
    fontSize: 27,
    marginBottom: 0,
    color: "#000000",
  },

  salesValue: {
    fontSize: 22,
    marginBottom: 0,
    color: "#a77c2c",
    overflowWrap: "anywhere",
  },

  welcomeCard: {
    background: "#fffdf8",
    color: "#000000",
    padding: 35,
    borderRadius: 10,
    border: "1px solid #e5dccd",
    marginTop: 30,
    maxWidth: 750,
    lineHeight: 1.7,
  },

  goldText: {
    color: "#a77c2c",
    fontSize: 11,
    letterSpacing: 2,
  },

  goldButton: {
    background: "#c49a45",
    color: "#000000",
    border: "none",
    padding: "13px 22px",
    borderRadius: 5,
    cursor: "pointer",
    fontWeight: "bold",
    marginTop: 12,
  },

  productHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 15,
    marginBottom: 25,
    color: "#000000",
  },

  formCard: {
    background: "#fffdf8",
    color: "#000000",
    padding: 28,
    border: "1px solid #e5dccd",
    borderRadius: 10,
    marginBottom: 30,
    maxWidth: 850,
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "0 20px",
  },

  field: {
    marginBottom: 18,
  },

  label: {
    display: "block",
    fontSize: 13,
    fontWeight: "bold",
    color: "#000000",
    marginTop: 15,
  },

  preview: {
    display: "block",
    width: 130,
    height: 130,
    objectFit: "cover",
    marginTop: 12,
    borderRadius: 8,
  },

  emptyCard: {
    background: "#fffdf8",
    color: "#000000",
    border: "1px solid #e5dccd",
    borderRadius: 10,
    padding: 40,
    textAlign: "center",
    marginTop: 20,
  },

  productGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 20,
  },

  productCard: {
    background: "#fffdf8",
    color: "#000000",
    border: "1px solid #e5dccd",
    borderRadius: 10,
    overflow: "hidden",
  },

  productImage: {
    width: "100%",
    height: 220,
    objectFit: "cover",
  },

  noImage: {
    height: 220,
    display: "grid",
    placeItems: "center",
    background: "#e8dfcf",
    color: "#000000",
    fontSize: 12,
    letterSpacing: 2,
  },

  editButton: {
    border: "1px solid #c49a45",
    color: "#000000",
    background: "transparent",
    padding: "9px 12px",
    borderRadius: 5,
    cursor: "pointer",
    marginRight: 7,
    marginBottom: 8,
  },

  deleteButton: {
    border: "1px solid #a34b3d",
    color: "#a34b3d",
    background: "transparent",
    padding: "9px 12px",
    borderRadius: 5,
    cursor: "pointer",
  },

  cancelButton: {
    border: "1px solid #000000",
    color: "#000000",
    background: "transparent",
    padding: "13px 22px",
    borderRadius: 5,
    cursor: "pointer",
    marginLeft: 10,
  },

  error: {
    background: "#f8e3df",
    color: "#a34b3d",
    padding: 12,
    borderRadius: 5,
    marginTop: 15,
    overflowWrap: "anywhere",
  },

  ordersList: {
    display: "grid",
    gap: 20,
    marginTop: 20,
  },

  orderCard: {
    background: "#fffdf8",
    color: "#000000",
    border: "1px solid #e5dccd",
    borderRadius: 10,
    padding: 25,
  },

  orderTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 15,
    borderBottom: "1px solid #e5dccd",
    paddingBottom: 15,
  },

  orderName: {
    color: "#000000",
    margin: "8px 0",
  },

  statusBadge: {
    padding: "8px 14px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: "bold",
  },

  badgeGroup: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },

  orderDetails: {
    padding: "12px 0",
    lineHeight: 1.8,
    overflowWrap: "anywhere",
    color: "#000000",
  },

  orderItems: {
    borderTop: "1px solid #e5dccd",
    borderBottom: "1px solid #e5dccd",
    padding: "12px 0",
    color: "#000000",
  },

  orderItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 15,
    padding: "10px 0",
    borderBottom: "1px solid #eee8dc",
  },

  orderBottom: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 20,
    paddingTop: 15,
  },

  orderTotal: {
    color: "#a77c2c",
  },

  paymentText: {
    color: "#000000",
    fontSize: 13,
  },

  statusControl: {
    width: 220,
    maxWidth: "100%",
  },

  salesPanel: {
    background: "#fffdf8",
    border: "1px solid #e5dccd",
    borderRadius: 10,
    padding: 25,
    marginTop: 25,
    color: "#000000",
  },

  salesTable: {
    width: "100%",
    color: "#000000",
  },

  salesTableHead: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr",
    gap: 12,
    padding: "12px 0",
    borderBottom: "1px solid #e5dccd",
    fontSize: 12,
    fontWeight: "bold",
    color: "#000000",
  },

  salesTableRow: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr",
    gap: 12,
    alignItems: "center",
    padding: "14px 0",
    borderBottom: "1px solid #eee8dc",
    fontSize: 13,
    color: "#000000",
  },

  historyRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 15,
    padding: "14px 0",
    borderBottom: "1px solid #eee8dc",
    color: "#000000",
  },

  salesNote: {
    color: "#000000",
    fontSize: 12,
    marginTop: 18,
    lineHeight: 1.6,
  },
};

export default Admin;