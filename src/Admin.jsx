import { useEffect, useState } from "react";
import { supabase } from "./supabase";

const ADMIN_USER_ID = "1ebf9380-7d3b-4cca-a1c2-d4c1cb20290e";

const initialForm = {
  name: "",
  brand: "",
  category: "Men",
  price: "",
  size: "100ml",
  stock: "",
  concentration: "EDP",
  longevity: "",
  occasion: "",
  topNotes: "",
  middleNotes: "",
  baseNotes: "",
  description: "",
};

const inputStyle = {
  width: "100%",
  padding: "12px",
  border: "1px solid #ddd3c2",
  borderRadius: "5px",
  background: "#fffdf8",
  color: "#171512",
  boxSizing: "border-box",
  fontSize: "14px",
  marginTop: "7px",
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

  const { data } = supabase.storage
    .from("product-images")
    .getPublicUrl(filePath);

  return data.publicUrl;
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
      const imageBlob = await response.blob();

      const imageFile = new File(
        [imageBlob],
        `old-product-${Date.now()}.jpg`,
        { type: imageBlob.type || "image/jpeg" }
      );

      imageUrl = await uploadImage(imageFile, userId);
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
    "Dashboard",
    "Products",
    "Orders",
    "Customers",
    "Sales",
    "Settings",
  ];

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

      setProducts(data.map(formatProduct));
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

        if (currentUser && currentUser.id !== ADMIN_USER_ID) {
          await supabase.auth.signOut();
          setUser(null);
          setError(
            "This account is not authorized to access the admin dashboard."
          );
          return;
        }

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

      if (data.user.id !== ADMIN_USER_ID) {
        await supabase.auth.signOut();
        setUser(null);
        throw new Error(
          "This account is not authorized to access the admin dashboard."
        );
      }

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

  async function updateOrderStatus(orderId, newStatus) {
    try {
      setError("");

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

          <h2>Administrator Login</h2>

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

                if (item === "Orders") {
                  loadOrders();
                }
              }}
              style={{
                ...styles.menuButton,
                background:
                  activeTab === item ? "#c49a45" : "transparent",
                color:
                  activeTab === item ? "#111" : "#eee5d5",
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

            <div style={styles.adminLabel}>
              Administrator
            </div>
          </div>
        </header>

        {error && <p style={styles.error}>{error}</p>}

        {activeTab === "Dashboard" && (
          <>
            <h2 style={styles.sectionTitle}>
              Store overview
            </h2>

            <div style={styles.stats}>
              {[
                ["Total Products", products.length],
                ["Total Orders", orders.length],
                [
                  "Pending Orders",
                  orders.filter((order) => order.status === "Pending").length,
                ],
                [
                  "Delivered Orders",
                  orders.filter((order) => order.status === "Delivered").length,
                ],
              ].map(([label, value]) => (
                <div key={label} style={styles.statCard}>
                  <p style={styles.smallText}>{label}</p>
                  <h2 style={styles.statValue}>{value}</h2>
                </div>
              ))}
            </div>

            <div style={styles.welcomeCard}>
              <p style={styles.goldText}>
                WELCOME TO YOUR STORE
              </p>

              <h2>Manage your fragrance business.</h2>

              <p>
                Your perfumes and customer orders are now
                connected to your online database.
              </p>

              <button
                style={styles.goldButton}
                onClick={() => setActiveTab("Products")}
              >
                Manage Products
              </button>
            </div>
          </>
        )}

        {activeTab === "Products" && (
          <>
            <div style={styles.productHeader}>
              <div>
                <h2 style={styles.sectionTitle}>
                  Your fragrances
                </h2>

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
                <p style={styles.goldText}>
                  PRODUCT INFORMATION
                </p>

                <h2>
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
                        "30ml",
                        "50ml",
                        "75ml",
                        "100ml",
                        "125ml",
                        "200ml",
                      ].map((size) => (
                        <option key={size}>{size}</option>
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
                        "EDP",
                        "EDT",
                        "EDC",
                        "Extrait de Parfum",
                        "Parfum",
                        "Body Mist",
                      ].map((item) => (
                        <option key={item}>{item}</option>
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
                      <div style={styles.noImage}>
                        NO IMAGE
                      </div>
                    )}

                    <div style={{ padding: "18px" }}>
                      <p style={styles.goldText}>
                        {product.brand}
                      </p>

                      <h3>{product.name}</h3>

                      <p style={styles.smallText}>
                        {product.category} · {product.size} ·{" "}
                        {product.concentration}
                      </p>

                      <h3 style={{ color: "#a77c2c" }}>
                        GH₵{Number(product.price).toFixed(2)}
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

        {activeTab === "Orders" && (
          <>
            <div style={styles.productHeader}>
              <div>
                <h2 style={styles.sectionTitle}>
                  Customer Orders
                </h2>

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
                  Customer orders will appear here when they
                  purchase from your shop.
                </p>
              </div>
            ) : (
              <div style={styles.ordersList}>
                {orders.map((order) => (
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
                    </div>

                    <div style={styles.orderDetails}>
                      <p>
                        <strong>Phone:</strong>{" "}
                        {order.customer_phone}
                      </p>

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
                    </div>

                    <div style={styles.orderItems}>
                      <h3>Items Ordered</h3>

                      {Array.isArray(order.items) &&
                        order.items.map((item, index) => (
                          <div
                            key={index}
                            style={styles.orderItem}
                          >
                            <div>
                              <strong>{item.name}</strong>
                              <p style={styles.smallText}>
                                {item.brand || ""} · {item.size || ""}
                                {" "}· Quantity: {item.quantity || 1}
                              </p>
                            </div>

                            <strong>
                              GH₵
                              {(
                                Number(item.price || 0) *
                                Number(item.quantity || 1)
                              ).toFixed(2)}
                            </strong>
                          </div>
                        ))}
                    </div>

                    <div style={styles.orderBottom}>
                      <h3 style={styles.orderTotal}>
                        Total: GH₵
                        {Number(order.total).toFixed(2)}
                      </h3>

                      <div style={styles.statusControl}>
                        <label style={styles.label}>
                          Update Order Status
                        </label>

                        <select
                          style={inputStyle}
                          value={order.status}
                          onChange={(e) =>
                            updateOrderStatus(
                              order.id,
                              e.target.value
                            )
                          }
                        >
                          {[
                            "Pending",
                            "Confirmed",
                            "Processing",
                            "Dispatched",
                            "Delivered",
                            "Cancelled",
                          ].map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab !== "Dashboard" &&
          activeTab !== "Products" &&
          activeTab !== "Orders" && (
            <div style={styles.welcomeCard}>
              <p style={styles.goldText}>
                BROWNES FRAGRANCE
              </p>

              <h2>{activeTab}</h2>

              <p>
                This section is ready for us to build.
                We'll add its features step by step.
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
    padding: "20px",
    boxSizing: "border-box",
    fontFamily: "Arial, sans-serif",
    color: "#171512",
  },

  loginCard: {
    background: "#fffdf8",
    color: "#171512",
    padding: "35px",
    borderRadius: "10px",
    width: "100%",
    maxWidth: "400px",
    boxSizing: "border-box",
  },

  loginLogo: {
    color: "#a77c2c",
    letterSpacing: "5px",
    textAlign: "center",
    marginBottom: "5px",
  },

  loginSub: {
    textAlign: "center",
    letterSpacing: "3px",
    fontSize: "10px",
    color: "#887c69",
    marginBottom: "35px",
  },

  container: {
    minHeight: "100vh",
    width: "100%",
    display: "flex",
    backgroundColor: "#f6f0e4",
    backgroundImage: `linear-gradient(135deg, rgba(255,255,255,.72), rgba(239,228,208,.48), rgba(255,250,240,.72)), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 800'%3E%3Cg fill='none' stroke='%23c49a4a' stroke-width='2' opacity='.38'%3E%3Cpath d='M-80 120 C90 40 120 220 280 145 S470 20 620 120 820 245 980 130 1130 45 1280 100'/%3E%3Cpath d='M-70 138 C95 58 130 238 290 163 S480 38 630 138 830 263 990 148 1140 63 1290 118' stroke-width='1'/%3E%3Cpath d='M-60 620 C110 540 180 700 330 610 S520 490 680 600 850 720 1010 610 1160 520 1300 580'/%3E%3Cpath d='M-55 642 C115 562 185 722 335 632 S525 512 685 622 855 742 1015 632 1165 542 1305 602' stroke-width='1'/%3E%3Cpath d='M760 -40 C690 100 850 160 770 290 S690 450 790 540 910 690 830 850' stroke-width='1.5'/%3E%3C/g%3E%3C/svg%3E")`,
    backgroundSize: "cover, 1200px 800px",
    backgroundAttachment: "fixed",
    width: "100%",
    color: "#171512",
    fontFamily: "Arial, sans-serif",
  },

  sidebar: {
    width: "230px",
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
    letterSpacing: "4px",
    marginBottom: "4px",
  },

  logoSub: {
    fontSize: "10px",
    letterSpacing: "3px",
    color: "#c9bda8",
    marginTop: "0",
    marginBottom: "45px",
  },

  menuButton: {
    display: "block",
    width: "100%",
    border: "none",
    borderRadius: "6px",
    padding: "14px",
    marginBottom: "9px",
    textAlign: "left",
    fontSize: "14px",
    cursor: "pointer",
  },

  logoutButton: {
    marginTop: "25px",
    padding: "12px",
    background: "transparent",
    border: "1px solid #c49a45",
    color: "#c49a45",
    borderRadius: "5px",
    cursor: "pointer",
  },

  sidebarBottom: {
    marginTop: "auto",
    color: "#c49a45",
    fontSize: "12px",
  },

  main: {
    flex: 1,
    padding: "35px",
    minWidth: 0,
    color: "#171512",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "15px",
    borderBottom: "1px solid #ddd3c2",
    paddingBottom: "22px",
    color: "#171512",
  },

  smallText: {
    fontSize: "11px",
    color: "#514735",
    letterSpacing: "1.5px",
  },

  heading: {
    fontSize: "30px",
    margin: "8px 0",
    color: "#171512",
  },

  headerActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "12px",
  },

  backToStore: {
    display: "inline-block",
    padding: "12px 16px",
    border: "1px solid #c49a45",
    borderRadius: "5px",
    color: "#171512",
    background: "rgba(255, 250, 240, 0.82)",
    textDecoration: "none",
    fontSize: "11px",
    fontWeight: "bold",
    letterSpacing: "1px",
    whiteSpace: "nowrap",
  },

  adminLabel: {
    background: "#e8dfcf",
    color: "#171512",
    padding: "12px 18px",
    borderRadius: "30px",
    fontSize: "12px",
  },

  sectionTitle: {
    marginTop: "20px",
    fontSize: "19px",
    color: "#171512",
  },

  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "18px",
    marginTop: "20px",
  },

  statCard: {
    background: "#fffdf8",
    color: "#171512",
    padding: "22px",
    border: "1px solid #e5dccd",
    borderRadius: "9px",
  },

  statValue: {
    fontSize: "27px",
    marginBottom: "0",
    color: "#171512",
  },

  welcomeCard: {
    background: "#fffdf8",
    color: "#171512",
    padding: "35px",
    borderRadius: "10px",
    border: "1px solid #e5dccd",
    marginTop: "30px",
    maxWidth: "750px",
    lineHeight: 1.7,
  },

  goldText: {
    color: "#a77c2c",
    fontSize: "11px",
    letterSpacing: "2px",
  },

  goldButton: {
    background: "#c49a45",
    color: "#171512",
    border: "none",
    padding: "13px 22px",
    borderRadius: "5px",
    cursor: "pointer",
    fontWeight: "bold",
    marginTop: "12px",
  },

  productHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "15px",
    marginBottom: "25px",
    color: "#171512",
  },

  formCard: {
    background: "#fffdf8",
    color: "#171512",
    padding: "28px",
    border: "1px solid #e5dccd",
    borderRadius: "10px",
    marginBottom: "30px",
    maxWidth: "850px",
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "0 20px",
  },

  field: {
    marginBottom: "18px",
  },

  label: {
    display: "block",
    fontSize: "13px",
    fontWeight: "bold",
    color: "#171512",
    marginTop: "15px",
  },

  preview: {
    display: "block",
    width: "130px",
    height: "130px",
    objectFit: "cover",
    marginTop: "12px",
    borderRadius: "8px",
  },

  emptyCard: {
    background: "#fffdf8",
    color: "#171512",
    border: "1px solid #e5dccd",
    borderRadius: "10px",
    padding: "40px",
    textAlign: "center",
    marginTop: "20px",
  },

  productGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "20px",
  },

  productCard: {
    background: "#fffdf8",
    color: "#171512",
    border: "1px solid #e5dccd",
    borderRadius: "10px",
    overflow: "hidden",
  },

  productImage: {
    width: "100%",
    height: "220px",
    objectFit: "cover",
  },

  noImage: {
    height: "220px",
    display: "grid",
    placeItems: "center",
    background: "#e8dfcf",
    color: "#514735",
    fontSize: "12px",
    letterSpacing: "2px",
  },

  editButton: {
    border: "1px solid #c49a45",
    color: "#8a682b",
    background: "transparent",
    padding: "9px 12px",
    borderRadius: "5px",
    cursor: "pointer",
    marginRight: "7px",
    marginBottom: "8px",
  },

  deleteButton: {
    border: "1px solid #a34b3d",
    color: "#a34b3d",
    background: "transparent",
    padding: "9px 12px",
    borderRadius: "5px",
    cursor: "pointer",
  },

  cancelButton: {
    border: "1px solid #887c69",
    color: "#514735",
    background: "transparent",
    padding: "13px 22px",
    borderRadius: "5px",
    cursor: "pointer",
    marginLeft: "10px",
  },

  error: {
    background: "#f8e3df",
    color: "#a34b3d",
    padding: "12px",
    borderRadius: "5px",
    marginTop: "15px",
    overflowWrap: "anywhere",
  },

  ordersList: {
    display: "grid",
    gap: "20px",
    marginTop: "20px",
  },

  orderCard: {
    background: "#fffdf8",
    color: "#171512",
    border: "1px solid #e5dccd",
    borderRadius: "10px",
    padding: "25px",
  },

  orderTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "15px",
    borderBottom: "1px solid #e5dccd",
    paddingBottom: "15px",
  },

  orderName: {
    color: "#171512",
    margin: "8px 0",
  },

  statusBadge: {
    padding: "8px 14px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: "bold",
  },

  orderDetails: {
    padding: "12px 0",
    lineHeight: 1.8,
    overflowWrap: "anywhere",
    color: "#171512",
  },

  orderItems: {
    borderTop: "1px solid #e5dccd",
    borderBottom: "1px solid #e5dccd",
    padding: "12px 0",
    color: "#171512",
  },

  orderItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "15px",
    padding: "10px 0",
    borderBottom: "1px solid #eee8dc",
  },

  orderBottom: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "20px",
    paddingTop: "15px",
  },

  orderTotal: {
    color: "#a77c2c",
  },

  statusControl: {
    width: "220px",
    maxWidth: "100%",
  },
};

export default Admin;