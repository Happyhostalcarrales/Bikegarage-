// --- 1. FIREBASE CONFIGURACIÓN E INICIALIZACIÓN ---
    
// ¡¡¡ RECUERDA: Las claves de la API están diseñadas para ser públicas !!!
// La seguridad se aplica en la consola de Firebase con las Reglas de Seguridad.
const firebaseConfig = {
  apiKey: "AIzaSyA3D7fH6QpdG7mUSNhFfUzD6RWje8TpGEk",
  authDomain: "hostaldatossincro.firebaseapp.com",
  databaseURL: "https://hostaldatossincro-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "hostaldatossincro",
  storageBucket: "hostaldatossincro.firebasestorage.app",
  messagingSenderId: "955112940193",
  appId: "1:955112940193:web:f30f52858c1e6c0ddc46e0"
};

// Intenta inicializar Firebase, si falla, al menos el resto del JS no se detendrá bruscamente.
try {
    firebase.initializeApp(firebaseConfig);
} catch (e) {
    console.error("FIREBASE INITIALIZATION ERROR: ", e);
}

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage(); 
    
// VARIABLES GLOBALES
let allData = [];
let userId = null;
let dbRef = null; 
let unsubscribeFirestore = null; 
let currentMaintenanceId = null; 
let currentBikeId = null; 

// Componentes de bicicleta por defecto (para facilitar la carga inicial)
const DEFAULT_COMPONENTS = [
    { name: "Horquilla", notes: "Marca, modelo, recorrido...", id: 'comp-' + Date.now() + 1 },
    { name: "Amortiguador", notes: "Marca, modelo...", id: 'comp-' + Date.now() + 2 },
    { name: "Ruedas", notes: "Marca, modelo, ancho...", id: 'comp-' + Date.now() + 3 },
    { name: "Transmisión", notes: "Marca y número de velocidades/platos", id: 'comp-' + Date.now() + 4 },
    { name: "Frenos", notes: "Marca, modelo, tipo de pastillas", id: 'comp-' + Date.now() + 5 },
];


// --- FUNCIONES AUXILIARES DE IMAGEN ---

/**
 * Elimina un archivo de Firebase Storage usando su URL completa.
 * @param {string} url - La URL de descarga del archivo.
 * @returns {boolean} True si se eliminó correctamente o si la URL era nula/vacía.
 */
async function deleteImageFromStorage(url) {
    if (!url) return true;
    try {
        // La referencia se obtiene desde la URL
        const fileRef = storage.refFromURL(url);
        await fileRef.delete();
        console.log("Imagen eliminada de Storage:", url);
        return true;
    } catch (error) {
        // Si el archivo no existe (404), tratamos como éxito para no bloquear el borrado de Firestore.
        if (error.code_ === 'storage/object-not-found') {
            console.warn("Archivo de Storage no encontrado, continuando con el borrado de Firestore.");
            return true;
        }
        console.error("Error al eliminar la imagen de Storage:", error);
        showToast("❌ Error al eliminar la imagen de Storage.");
        return false;
    }
}


// --- 2. FUNCIONES DE AUTENTICACIÓN ---

function displayAuthError(message) {
  const errorEl = document.getElementById('auth-error');
  if (errorEl) { // Protección adicional
      errorEl.textContent = message;
      errorEl.style.display = 'block';
      setTimeout(() => {
        errorEl.style.display = 'none';
      }, 5000);
  }
}

async function handleLogin(action) {
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');
  errorEl.style.display = 'none';

  if (!email || !password) {
    displayAuthError("Por favor, introduce correo y contraseña.");
    return;
  }

  try {
    if (action === 'login') {
      await auth.signInWithEmailAndPassword(email, password);
      showToast("✅ Sesión iniciada correctamente");
    } else if (action === 'register') {
      await auth.createUserWithEmailAndPassword(email, password);
      showToast("✅ Registro exitoso. ¡Bienvenido!");
    }
  } catch (error) {
    let errorMessage = "Ocurrió un error de autenticación.";
    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
      errorMessage = "Correo o contraseña inválidos.";
    } else if (error.code === 'auth/email-already-in-use') {
      errorMessage = "El correo ya está en uso. Intenta iniciar sesión.";
    } else if (error.code === 'auth/weak-password') {
      errorMessage = "La contraseña debe tener al menos 6 caracteres.";
    }
    displayAuthError(errorMessage);
  }
}

async function handleLogout() {
  try {
    await auth.signOut();
    showToast("🚪 Sesión cerrada.");
  } catch (error) {
    showToast("❌ Error al cerrar sesión.");
  }
}

// Listener de estado de autenticación (Carga la app o muestra el login)
auth.onAuthStateChanged(user => {
  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');

  if (user) {
    // Usuario logueado: Ocultar Login, Mostrar App
    if (loginView) loginView.style.display = 'none';
    if (appView) appView.style.display = 'block';
    userId = user.uid;
    // La referencia a la base de datos es específica para el usuario
    dbRef = db.collection('users').doc(userId).collection('appData');
    listenToDataChanges(); // Iniciar la sincronización
  } else {
    // Usuario deslogueado: Mostrar Login, Ocultar App
    if (loginView) loginView.style.display = 'flex';
    if (appView) appView.style.display = 'none';
    userId = null;
    allData = []; 
    if (unsubscribeFirestore) {
      unsubscribeFirestore(); 
      unsubscribeFirestore = null;
    }
    // Limpiar vistas (si los elementos existen)
    if (document.getElementById('bikes-list')) document.getElementById('bikes-list').innerHTML = '';
    if (document.getElementById('maintenance-list')) document.getElementById('maintenance-list').innerHTML = '';
    if (document.getElementById('stock-list')) document.getElementById('stock-list').innerHTML = '';
    if (document.getElementById('general-stats')) document.getElementById('general-stats').innerHTML = '';
  }
});

// --- 3. FUNCIONES DE FIREBASE FIRESTORE PARA SINCRONIZACIÓN Y CRUD ---

function listenToDataChanges() {
  if (unsubscribeFirestore) {
    unsubscribeFirestore(); 
  }
  
  // Sincronización en tiempo real
  unsubscribeFirestore = dbRef.onSnapshot(snapshot => {
    const changes = snapshot.docChanges();
    let shouldRender = false;
    
    changes.forEach(change => {
      const data = { id: change.doc.id, ...change.doc.data() };
      
      if (change.type === 'added') {
        allData.push(data);
        shouldRender = true;
      } else if (change.type === 'modified') {
        const index = allData.findIndex(d => d.id === data.id);
        if (index !== -1) {
          allData[index] = data;
          shouldRender = true;
        }
      } else if (change.type === 'removed') {
        allData = allData.filter(d => d.id !== data.id);
        shouldRender = true;
      }
    });

    if (shouldRender) {
      onDataChanged(allData); 
    }
  }, err => {
    console.error("Error al escuchar Firestore:", err);
    showToast("❌ Error al sincronizar datos. Intenta recargar.");
  });
}

// Manejador de cambios 
function onDataChanged(data) {
  allData = data;
  renderBikes();
  renderMaintenance();
  renderStock();
  renderStats();
  updateBikeSelectors();
  updateComponentFilter();
  updateStockCategoryFilter(); 
}

// Funciones CRUD usando Firestore

async function createData(data) {
  try {
    const docRef = dbRef.doc(); 
    const newData = { ...data, id: docRef.id };
    await docRef.set(newData);
    return { isOk: true };
  } catch (error) {
    console.error("Error creando dato:", error);
    return { isOk: false, error };
  }
}

async function updateData(data) {
  try {
    await dbRef.doc(data.id).update(data);
    return { isOk: true };
  } catch (error) {
    console.error("Error actualizando dato:", error);
    return { isOk: false, error };
  }
}

async function deleteData(data) {
  try {
    await dbRef.doc(data.id).delete();
    return { isOk: true };
  } catch (error) {
    console.error("Error eliminando dato:", error);
    return { isOk: false, error };
  }
}


// --- 4. HANDLERS DE FORMULARIO DE CREACIÓN / EDICIÓN ---

async function handleAddBike(event) {
  event.preventDefault();
  
  const saveBtn = document.getElementById('save-bike-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando...';

  // 1. Obtener el archivo de imagen
  const fileInput = document.getElementById('bike-image');
  const file = fileInput.files[0];
  let imageURL = null; 

  // 2. Si hay un archivo, subirlo a Firebase Storage
  if (file) {
    saveBtn.textContent = 'Subiendo imagen...';
    const filePath = `uploads/${userId}/bikes/${Date.now()}_${file.name}`;
    const fileRef = storage.ref(filePath);
    
    try {
      const snapshot = await fileRef.put(file);
      imageURL = await snapshot.ref.getDownloadURL();
      saveBtn.textContent = 'Guardando datos...';
    } catch (error) {
      console.error("Error al subir imagen:", error);
      showToast("❌ Error al subir la imagen. Inténtalo de nuevo.");
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar Bicicleta';
      return; 
    }
  }

  // 3. Preparar los datos de la bicicleta (con la URL de la imagen si existe)
  const bikeData = {
    type: 'bike',
    bike_name: document.getElementById('bike-name').value,
    bike_type: document.getElementById('bike-type').value,
    bike_color: document.getElementById('bike-color').value,
    total_km: parseFloat(document.getElementById('bike-km').value) || 0,
    components: DEFAULT_COMPONENTS.map(c => ({...c, id: 'comp-' + Date.now() + Math.random()})),
    created_at: new Date().toISOString(),
    imageURL: imageURL 
  };

  // 4. Guardar los datos en Firestore
  const result = await createData(bikeData);
  
  saveBtn.disabled = false;
  saveBtn.textContent = 'Guardar Bicicleta';

  if (result.isOk) {
    hideAddBikeForm(); 
    showToast("✅ Bicicleta registrada correctamente");
  } else {
    showToast("❌ Error al guardar la bicicleta");
  }
}

// Mostrar modal de edición de bicicleta (Corregido el bug de Cannot set properties of null)
function showEditBikeModal(bikeId) {
    const bike = allData.find(d => d.id === bikeId);
    if (!bike) return;

    currentBikeId = bikeId;

    // 1. Rellenar campos principales (protegidos contra null con checks)
    document.getElementById('edit-bike-id').value = bikeId;
    
    // Asignación con protección
    const nameInput = document.getElementById('edit-bike-name');
    if (nameInput) nameInput.value = bike.bike_name;

    const typeSelect = document.getElementById('edit-bike-type');
    if (typeSelect) typeSelect.value = bike.bike_type;

    const colorInput = document.getElementById('edit-bike-color');
    if (colorInput) colorInput.value = bike.bike_color;

    const kmInput = document.getElementById('edit-bike-km');
    if (kmInput) kmInput.value = bike.total_km || ''; 
    
    // El input de tipo file no se rellena por seguridad.

    // 2. Rellenar y renderizar componentes
    renderComponentInputs(bike.components || DEFAULT_COMPONENTS);

    // 3. Mostrar el modal
    document.getElementById('edit-bike-modal').style.display = 'flex';
}

// Manejar la actualización de la bicicleta (AHORA incluye la lógica de imagen)
async function handleUpdateBike() {
    
    const bikeId = document.getElementById('edit-bike-id').value;
    const bike = allData.find(d => d.id === bikeId);
    if (!bike) return;

    const saveBtn = document.querySelector('#edit-bike-modal .btn-primary');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Actualizando...';

    // Lógica para subida/actualización de imagen
    const fileInput = document.getElementById('edit-bike-image');
    const file = fileInput.files[0];
    let imageURL = bike.imageURL; // Mantener la URL antigua por defecto

    if (file) {
        saveBtn.textContent = 'Subiendo nueva imagen...';
        // Usar una ruta única para sobreescribir la imagen antigua (si existe) o crear una nueva
        const filePath = `uploads/${userId}/bikes/${Date.now()}_${file.name}`;
        const fileRef = storage.ref(filePath);
        
        try {
            // Sube el nuevo archivo.
            const snapshot = await fileRef.put(file);
            const newImageURL = await snapshot.ref.getDownloadURL();
            
            // Si ya existía una URL antigua, borrar la imagen antigua (opcional, para liberar espacio)
            // if (bike.imageURL) { deleteImageFromStorage(bike.imageURL); }
            
            imageURL = newImageURL; // Usar la nueva URL
            saveBtn.textContent = 'Guardando datos...';
        } catch (error) {
            console.error("Error al subir imagen:", error);
            showToast("❌ Error al subir la imagen nueva.");
            saveBtn.disabled = false;
            saveBtn.textContent = 'Guardar Cambios';
            return; 
        }
    }


    // 1. Recoger los componentes editados
    const componentsListElement = document.getElementById('components-list-edit');
    const updatedComponents = [];

    componentsListElement.querySelectorAll('.component-item-edit').forEach(item => {
        const nameInput = item.querySelector('.component-name-input');
        const notesInput = item.querySelector('.component-notes-input');
        const componentId = item.getAttribute('data-id');

        if (nameInput.value.trim()) {
            updatedComponents.push({
                id: componentId,
                name: nameInput.value.trim(),
                notes: notesInput ? notesInput.value.trim() : ''
            });
        }
    });
    
    const updatedBikeData = {
        // Campos que pueden cambiar
        bike_name: document.getElementById('edit-bike-name').value,
        bike_type: document.getElementById('edit-bike-type').value,
        bike_color: document.getElementById('edit-bike-color').value,
        components: updatedComponents, 
        imageURL: imageURL, // GUARDA LA NUEVA URL O LA ANTIGUA
        id: bikeId
    };
    
    // Llamar a la función de actualización de Firestore
    const result = await updateData(updatedBikeData);

    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar Cambios';

    if (result.isOk) {
        closeModal('edit-bike-modal');
        showToast("✅ Bicicleta actualizada correctamente");
    } else {
        showToast("❌ Error al actualizar la bicicleta");
    }
}

// Renderizar los inputs de componentes en el modal de edición
function renderComponentInputs(components) {
    const listContainer = document.getElementById('components-list-edit');
    listContainer.innerHTML = ''; // Limpiar la lista

    if (!components || components.length === 0) {
        components = DEFAULT_COMPONENTS;
    }

    components.forEach(comp => {
        const item = document.createElement('div');
        item.className = 'component-item-edit';
        item.setAttribute('data-id', comp.id);
        item.innerHTML = `
            <input type="text" class="component-name-input" placeholder="Nombre (Ej: Horquilla)" value="${comp.name}">
            <input type="text" class="component-notes-input" placeholder="Notas (Ej: RockShox 150mm)" value="${comp.notes || ''}">
            <button type="button" class="delete-component-btn" onclick="removeComponentInput(this)">X</button>
        `;
        listContainer.appendChild(item);
    });
}

// Añadir un nuevo campo de componente al modal de edición
function addComponentInput() {
    const listContainer = document.getElementById('components-list-edit');
    const newItemId = 'comp-' + Date.now() + Math.random(); 
    
    const item = document.createElement('div');
    item.className = 'component-item-edit';
    item.setAttribute('data-id', newItemId);
    item.innerHTML = `
        <input type="text" class="component-name-input" placeholder="Nombre (Ej: Cadena)" value="">
        <input type="text" class="component-notes-input" placeholder="Notas (Ej: KMC X11)" value="">
        <button type="button" class="delete-component-btn" onclick="removeComponentInput(this)">X</button>
    `;
    listContainer.appendChild(item);
}

// Eliminar un campo de componente
function removeComponentInput(buttonElement) {
    buttonElement.closest('.component-item-edit').remove();
}


// --- 6. HANDLERS CRUD RESTANTES (MANTENIMIENTO y STOCK) ---

async function handleAddMaintenance(event) {
    event.preventDefault();
    
    const saveBtn = document.getElementById('save-maintenance-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    const bikeId = document.getElementById('maintenance-bike').value;
    const bike = allData.find(d => d.id === bikeId);
    if (!bike) {
        showToast("⚠️ Bicicleta no encontrada.");
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar Mantenimiento';
        return;
    }
    
    // Lógica de subida de imagen para MANTENIMIENTO
    const fileInput = document.getElementById('maintenance-image');
    const file = fileInput.files[0];
    let imageURL = null; 

    if (file) {
        saveBtn.textContent = 'Subiendo imagen...';
        const filePath = `uploads/${userId}/maintenance/${Date.now()}_${file.name}`;
        const fileRef = storage.ref(filePath);
        
        try {
            const snapshot = await fileRef.put(file);
            imageURL = await snapshot.ref.getDownloadURL();
            saveBtn.textContent = 'Guardando datos...';
        } catch (error) {
            console.error("Error al subir imagen:", error);
            showToast("❌ Error al subir la imagen del mantenimiento.");
            saveBtn.disabled = false;
            saveBtn.textContent = 'Guardar Mantenimiento';
            return; 
        }
    }


    const kmAtMaintenance = parseFloat(document.getElementById('maintenance-km').value) || null;
    const nextMaintenanceKm = parseFloat(document.getElementById('next-maintenance-km').value) || null;

    const maintenanceData = {
        type: 'maintenance',
        bike_id: bikeId,
        bike_name: bike.bike_name,
        maintenance_type: document.getElementById('maintenance-type').value,
        component: document.getElementById('maintenance-component').value,
        date: document.getElementById('maintenance-date').value,
        km_at_maintenance: kmAtMaintenance,
        cost: parseFloat(document.getElementById('maintenance-cost').value) || 0,
        notes: document.getElementById('maintenance-notes').value,
        next_maintenance_km: nextMaintenanceKm,
        imageURL: imageURL, // <-- CAMPO NUEVO
        created_at: new Date().toISOString()
    };

    const result = await createData(maintenanceData);
    
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar Mantenimiento';

    if (result.isOk) {
        hideAddMaintenanceForm();
        showToast("✅ Mantenimiento registrado correctamente");
    } else {
        showToast("❌ Error al guardar el mantenimiento");
    }
}

async function handleAddStock(event) {
    event.preventDefault();
    
    const saveBtn = document.getElementById('save-stock-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    // Lógica de subida de imagen para STOCK
    const fileInput = document.getElementById('stock-image');
    const file = fileInput.files[0];
    let imageURL = null; 

    if (file) {
        saveBtn.textContent = 'Subiendo imagen...';
        const filePath = `uploads/${userId}/stock/${Date.now()}_${file.name}`;
        const fileRef = storage.ref(filePath);
        
        try {
            const snapshot = await fileRef.put(file);
            imageURL = await snapshot.ref.getDownloadURL();
            saveBtn.textContent = 'Guardando datos...';
        } catch (error) {
            console.error("Error al subir imagen:", error);
            showToast("❌ Error al subir la imagen del material.");
            saveBtn.disabled = false;
            saveBtn.textContent = 'Guardar Material';
            return; 
        }
    }
    
    
    const stockData = {
        type: 'stock',
        stock_name: document.getElementById('stock-name').value,
        stock_category: document.getElementById('stock-category').value,
        stock_brand: document.getElementById('stock-brand').value || '',
        stock_quantity: parseInt(document.getElementById('stock-quantity').value) || 0,
        stock_min_quantity: parseInt(document.getElementById('stock-min-quantity').value) || 1,
        stock_unit_price: parseFloat(document.getElementById('stock-unit-price').value) || 0,
        stock_location: document.getElementById('stock-location').value || '',
        stock_notes: document.getElementById('stock-notes').value || '',
        imageURL: imageURL, // <-- CAMPO NUEVO
        created_at: new Date().toISOString()
    };

    const result = await createData(stockData);
    
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar Material';

    if (result.isOk) {
        hideAddStockForm();
        showToast("✅ Material añadido al inventario");
    } else {
        showToast("❌ Error al guardar el material");
    }
}

// BORRADO COMPLETO (Documento + Imagen de Storage)
async function deleteBike(bikeId) {
  const bike = allData.find(d => d.id === bikeId);
  if (!bike) return;

  const confirmBtn = document.getElementById('confirm-delete-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Eliminando...';
  }

  showToast("♻️ Eliminando bicicleta y archivos...");
  
  // 1. Eliminar imagen de Storage (si existe)
  if (bike.imageURL) {
    const deletedImage = await deleteImageFromStorage(bike.imageURL);
    if (!deletedImage) {
        closeModal('delete-bike-modal');
        return; // Detener si hay un error crítico en Storage
    }
  }

  // 2. Eliminar documento de Firestore
  const result = await deleteData(bike);

  closeModal('delete-bike-modal');

  if (!result.isOk) {
    showToast("❌ Error al eliminar la bicicleta");
  } else {
    showToast("✅ Bicicleta eliminada");
  }
}

// BORRADO COMPLETO (Documento + Imagen de Storage)
async function deleteMaintenance(maintenanceId) {
  const maintenance = allData.find(d => d.id === maintenanceId);
  if (!maintenance) return;

  const confirmBtn = document.getElementById('confirm-delete-maintenance-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Eliminando...';
  }
  
  showToast("♻️ Eliminando mantenimiento y archivos...");

  // 1. Eliminar imagen de Storage (si existe)
  if (maintenance.imageURL) {
      const deletedImage = await deleteImageFromStorage(maintenance.imageURL);
      if (!deletedImage) {
          closeModal('delete-maintenance-modal');
          return; 
      }
  }

  // 2. Eliminar documento de Firestore
  const result = await deleteData(maintenance);

  closeModal('delete-maintenance-modal');

  if (!result.isOk) {
    showToast("❌ Error al eliminar el mantenimiento");
  } else {
    showToast("✅ Mantenimiento eliminado");
  }
}

// BORRADO COMPLETO (Documento + Imagen de Storage)
async function deleteStock(stockId) {
  const stock = allData.find(d => d.id === stockId);
  if (!stock) return;

  const confirmBtn = document.getElementById('confirm-delete-stock-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Eliminando...';
  }
  
  showToast("♻️ Eliminando material y archivos...");

  // 1. Eliminar imagen de Storage (si existe)
  if (stock.imageURL) {
      const deletedImage = await deleteImageFromStorage(stock.imageURL);
      if (!deletedImage) {
          closeModal('delete-stock-modal');
          return; 
      }
  }
  
  // 2. Eliminar documento de Firestore
  const result = await deleteData(stock);

  closeModal('delete-stock-modal');

  if (!result.isOk) {
    showToast("❌ Error al eliminar el material");
  } else {
    showToast("✅ Material eliminado del inventario");
  }
}

// Resto de funciones (updateStockQuantity, updateBikeKm, handleUpdateMaintenance, showEditMaintenanceModal, showEditStockModal, handleUpdateStock...)

async function updateStockQuantity(stockId, change) {
  const stock = allData.find(d => d.id === stockId);
  if (!stock) return;

  const newQuantity = Math.max(0, stock.stock_quantity + change);
  const updatedStock = { ...stock, stock_quantity: newQuantity };

  const result = await updateData(updatedStock);

  if (!result.isOk) {
    showToast("❌ Error al actualizar la cantidad");
  }
}

async function updateBikeKm(bikeId) {
  const bike = allData.find(d => d.id === bikeId);
  if (!bike) return;

  const newKm = parseFloat(document.getElementById('new-km').value);
  
  if (newKm < bike.total_km) {
    showToast("⚠️ El nuevo kilometraje no puede ser menor al actual");
    return;
  }

  const updatedBike = { ...bike, total_km: newKm };
  const result = await updateData(updatedBike);

  if (result.isOk) {
    closeModal('km-modal'); 
    showToast("✅ Kilometraje actualizado correctamente");
  } else {
    showToast("❌ Error al actualizar el kilometraje");
  }
}

async function handleUpdateMaintenance() {
    const maintenanceId = document.getElementById('edit-maintenance-id').value;
    const maintenance = allData.find(d => d.id === maintenanceId);
    if (!maintenance) return;

    const saveBtn = document.querySelector('#edit-maintenance-modal .btn-primary');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Actualizando...';
    
    // NOTA: La lógica para SUBIR O BORRAR la imagen se añadiría aquí.

    const kmAtMaintenance = parseFloat(document.getElementById('edit-maintenance-km').value) || null;
    const nextMaintenanceKm = parseFloat(document.getElementById('edit-next-maintenance-km').value) || null;

    const updatedData = {
        maintenance_type: document.getElementById('edit-maintenance-type').value,
        component: document.getElementById('edit-maintenance-component').value,
        date: document.getElementById('edit-maintenance-date').value,
        km_at_maintenance: kmAtMaintenance,
        cost: parseFloat(document.getElementById('edit-maintenance-cost').value) || 0,
        notes: document.getElementById('edit-maintenance-notes').value,
        next_maintenance_km: nextMaintenanceKm,
        id: maintenanceId
    };
    
    const result = await updateData(updatedData);

    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar Cambios';

    if (result.isOk) {
        closeModal('edit-maintenance-modal');
        showToast("✅ Mantenimiento actualizado correctamente");
    } else {
        showToast("❌ Error al actualizar el mantenimiento");
    }
}

// CORREGIDO: showEditMaintenanceModal (Protegido contra TypeError)
function showEditMaintenanceModal(maintenanceId) {
  const maintenance = allData.find(d => d.id === maintenanceId);
  if (!maintenance) {
    showToast("❌ Error: No se encontró el mantenimiento.");
    return;
  }

  // 1. Rellenar los campos del formulario (usando || '' para seguridad)
  document.getElementById('edit-maintenance-id').value = maintenanceId;
  document.getElementById('edit-maintenance-bike').value = maintenance.bike_name || ''; 

  // Asignamos valores solo si los elementos SELECT existen
  const typeSelect = document.getElementById('edit-maintenance-type');
  if (typeSelect) typeSelect.value = maintenance.maintenance_type || '';

  const componentSelect = document.getElementById('edit-maintenance-component');
  if (componentSelect) componentSelect.value = maintenance.component || '';
  
  // Inputs de fecha y número
  document.getElementById('edit-maintenance-date').value = maintenance.date || '';
  document.getElementById('edit-maintenance-km').value = maintenance.km_at_maintenance || '';
  document.getElementById('edit-maintenance-cost').value = maintenance.cost || 0;
  document.getElementById('edit-next-maintenance-km').value = maintenance.next_maintenance_km || '';
  document.getElementById('edit-maintenance-notes').value = maintenance.notes || '';
  
  // 2. Mostrar el modal
  document.getElementById('edit-maintenance-modal').style.display = 'flex';
}

function showEditStockModal(stockId) {
  const stock = allData.find(d => d.id === stockId);
  if (!stock) return;

  // 1. Rellenar campos principales
  document.getElementById('edit-stock-id').value = stockId;
  document.getElementById('edit-stock-name').value = stock.stock_name;
  document.getElementById('edit-stock-category').value = stock.stock_category;
  document.getElementById('edit-stock-brand').value = stock.stock_brand || '';
  document.getElementById('edit-stock-quantity').value = stock.stock_quantity;
  document.getElementById('edit-stock-min-quantity').value = stock.stock_min_quantity;
  document.getElementById('edit-stock-unit-price').value = stock.stock_unit_price || 0;
  document.getElementById('edit-stock-location').value = stock.stock_location || '';
  document.getElementById('edit-stock-notes').value = stock.stock_notes || '';
  // NO rellenamos el input file.

  // 2. Mostrar el modal
  document.getElementById('edit-stock-modal').style.display = 'flex';
}

async function handleUpdateStock() {
    // (La lógica para actualizar la imagen aún no está implementada)
    
    const stockId = document.getElementById('edit-stock-id').value;
    const stock = allData.find(d => d.id === stockId);
    if (!stock) return;

    const saveBtn = document.querySelector('#edit-stock-modal .btn-primary');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Actualizando...';
    
    // NOTA: La lógica para SUBIR O BORRAR la imagen se añadiría aquí.

    const updatedStockData = {
        stock_name: document.getElementById('edit-stock-name').value,
        stock_category: document.getElementById('edit-stock-category').value,
        stock_brand: document.getElementById('edit-stock-brand').value || '',
        stock_quantity: parseInt(document.getElementById('edit-stock-quantity').value) || 0,
        stock_min_quantity: parseInt(document.getElementById('edit-stock-min-quantity').value) || 1,
        stock_unit_price: parseFloat(document.getElementById('edit-stock-unit-price').value) || 0,
        stock_location: document.getElementById('edit-stock-location').value || '',
        stock_notes: document.getElementById('edit-stock-notes').value || '',
        id: stockId 
    };
    
    const result = await updateData(updatedStockData);

    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar Cambios';

    if (result.isOk) {
        closeModal('edit-stock-modal');
        showToast("✅ Material actualizado correctamente");
    } else {
        showToast("❌ Error al actualizar el material");
    }
}


// --- 7. FUNCIONES DE UI Y RENDERIZADO ---

const defaultConfig = {
  app_title: "🚴 Mis Bicicletas",
  add_bike_button: "Nueva Bicicleta",
  add_maintenance_button: "Nuevo Mantenimiento",
  currency_symbol: "€",
  background_color: "#667eea",
  surface_color: "#ffffff",
  text_color: "#2d3748",
  primary_action_color: "#667eea",
  secondary_action_color: "#e53e3e"
};

function init() {
  const today = new Date().toISOString().split('T')[0];
  if (document.getElementById('maintenance-date')) document.getElementById('maintenance-date').value = today;
}

function switchTab(tab) {
  const tabs = document.querySelectorAll('.tab');
  const views = document.querySelectorAll('.view');
  
  tabs.forEach(t => t.classList.remove('active'));
  views.forEach(v => v.classList.remove('active'));
  
  // Usamos closest() para ser más robustos al hacer clic en el span/icono
  const targetTab = event.target.closest('.tab');
  if (targetTab) targetTab.classList.add('active');
  
  const targetView = document.getElementById(`${tab}-view`);
  if (targetView) targetView.classList.add('active');
  
  if (tab === 'stats') {
    renderStats();
  } else if (tab === 'stock') {
    renderStock();
  }
}

function showAddBikeForm() {
  document.getElementById('bike-form').style.display = 'block';
  document.getElementById('bikes-list').style.display = 'none';
}

function hideAddBikeForm() {
  document.getElementById('bike-form').style.display = 'none';
  document.getElementById('bikes-list').style.display = 'grid';
  document.getElementById('new-bike-form').reset();
}

function showAddMaintenanceForm() {
  document.getElementById('maintenance-form').style.display = 'block';
  document.getElementById('maintenance-list').style.display = 'none';
  document.querySelector('#maintenance-view .toolbar').style.display = 'none';
}

function hideAddMaintenanceForm() {
  document.getElementById('maintenance-form').style.display = 'none';
  document.getElementById('maintenance-list').style.display = 'flex';
  document.querySelector('#maintenance-view .toolbar').style.display = 'flex';
  document.getElementById('new-maintenance-form').reset();
  const today = new Date().toISOString().split('T')[0];
  if (document.getElementById('maintenance-date')) document.getElementById('maintenance-date').value = today;
}

function showAddStockForm() {
  document.getElementById('stock-form').style.display = 'block';
  document.getElementById('stock-list').style.display = 'none';
  // Corrección: Usar un selector específico para el toolbar de stock
  const stockToolbar = document.querySelector('#stock-view .toolbar'); 
  if (stockToolbar) stockToolbar.style.display = 'none';
}

function hideAddStockForm() {
  document.getElementById('stock-form').style.display = 'none';
  document.getElementById('stock-list').style.display = 'grid';
  // Corrección: Usar un selector específico para el toolbar de stock
  const stockToolbar = document.querySelector('#stock-view .toolbar');
  if (stockToolbar) stockToolbar.style.display = 'flex';
  document.getElementById('new-stock-form').reset();
}

// Función auxiliar para expandir/colapsar detalles (para tarjetas de bicicleta)
function toggleBikeDetails(bikeId) {
    const details = document.getElementById(`details-${bikeId}`);
    details.style.display = details.style.display === 'block' ? 'none' : 'block';
}

function renderBikes() {
  const bikesList = document.getElementById('bikes-list');
  const bikes = allData.filter(d => d.type === 'bike');

  if (bikes.length === 0) {
    bikesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🚴</div>
        <h3>No hay bicicletas registradas</h3>
        <p>Añade tu primera bicicleta para empezar a gestionar su mantenimiento profesionalmente</p>
      </div>
    `;
    return;
  }

  bikesList.innerHTML = bikes.map(bike => {
    const maintenance = allData.filter(d => d.type === 'maintenance' && d.bike_id === bike.id);
    const maintenanceCount = maintenance.length;
    const totalCost = maintenance.reduce((sum, m) => sum + (m.cost || 0), 0);
    
    const currencySymbol = defaultConfig.currency_symbol; 

    const upcomingMaintenances = maintenance
      .filter(m => m.next_maintenance_km && m.km_at_maintenance)
      .map(m => ({
        component: m.component,
        targetKm: m.km_at_maintenance + m.next_maintenance_km,
        kmLeft: (m.km_at_maintenance + m.next_maintenance_km) - bike.total_km
      }))
      .filter(m => m.kmLeft > 0)
      .sort((a, b) => a.kmLeft - b.kmLeft);

    const nextMaintenance = upcomingMaintenances[0];
    
    let alertClass = '';
    let alertIcon = '';
    let alertText = '';
    
    if (nextMaintenance) {
      if (nextMaintenance.kmLeft < 50) {
        alertClass = 'alert-critical';
        alertIcon = '🚨';
        alertText = `URGENTE: ${nextMaintenance.component} (${nextMaintenance.kmLeft.toFixed(0)} km)`;
      } else if (nextMaintenance.kmLeft < 150) {
        alertClass = 'alert-warning';
        alertIcon = '⚠️';
        alertText = `Próximo: ${nextMaintenance.component} (${nextMaintenance.kmLeft.toFixed(0)} km)`;
      } else {
        alertClass = 'alert-ok';
        alertIcon = '✅';
        alertText = `Todo OK - Próximo: ${nextMaintenance.component} (${nextMaintenance.kmLeft.toFixed(0)} km)`;
      }
    }

    // Listado de componentes para mostrar
    const componentsHtml = (bike.components || [])
      .map(c => `<span style="display: block; font-size: 13px; color: #718096;">• ${c.name}: ${c.notes}</span>`).join('');


    return `
      <div class="bike-card" onclick="toggleBikeDetails('${bike.id}')">
        
        ${bike.imageURL 
          ? `<img src="${bike.imageURL}" alt="${bike.bike_name}" class="bike-card-img">`
          : ''
        }
        
        <div class="bike-header">
          <div>
            ${!bike.imageURL ? '<div class="bike-icon">🚴</div>' : ''}
            <div class="bike-name">${bike.bike_name}</div>
            <div class="bike-type">${bike.bike_type} • ${bike.bike_color}</div>
          </div>
          <div style="display: flex; align-items: center;">
            <button class="edit-bike-btn" onclick="event.stopPropagation(); showEditBikeModal('${bike.id}')" title="Editar detalles y componentes">✏️</button>
            <button class="delete-bike" onclick="event.stopPropagation(); showDeleteBikeConfirmation('${bike.id}')" title="Eliminar bicicleta">×</button>
          </div>
        </div>
        
        <div id="details-${bike.id}" class="bike-details-hidden">

          <div style="margin-bottom: 15px; padding: 10px; background: #f7fafc; border-radius: 8px;">
              <strong style="font-size: 13px; display: block; margin-bottom: 5px;">Componentes:</strong>
              ${componentsHtml || '<span style="font-style: italic; font-size: 12px; color: #a0aec0;">No hay componentes añadidos.</span>'}
          </div>
          
          <div class="bike-km-display">
            <div class="km-value">
              <span>📍</span>
              <span>${bike.total_km.toFixed(1)} km</span>
            </div>
            <button class="edit-km-btn" onclick="event.stopPropagation(); showUpdateKmModal('${bike.id}')" title="Actualizar kilometraje">✏️</button>
          </div>
          ${nextMaintenance ? `<div class="alert-badge ${alertClass}">${alertIcon} ${alertText}</div>` : ''}
          <div class="bike-stats">
            <div class="bike-stat-item">
              <div class="bike-stat-value">${maintenanceCount}</div>
              <div class="bike-stat-label">Mantenimientos</div>
            </div>
            <div class="bike-stat-item">
              <div class="bike-stat-value">${totalCost.toFixed(0)}${currencySymbol}</div>
              <div class="bike-stat-label">Coste Total</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderMaintenance() {
  const maintenanceList = document.getElementById('maintenance-list');
  let maintenance = allData.filter(d => d.type === 'maintenance');

  if (currentFilter) {
    maintenance = maintenance.filter(m => m.bike_id === currentFilter);
  }

  if (currentComponentFilter) {
    maintenance = maintenance.filter(m => m.component === currentComponentFilter);
  }

  if (currentSearch) {
    const searchLower = currentSearch.toLowerCase();
    maintenance = maintenance.filter(m => 
      m.bike_name.toLowerCase().includes(searchLower) ||
      m.component.toLowerCase().includes(searchLower) ||
      m.maintenance_type.toLowerCase().includes(searchLower) ||
      (m.notes && m.notes.toLowerCase().includes(searchLower))
    );
  }

  maintenance.sort((a, b) => {
    switch(currentSort) {
      case 'date-desc':
        return new Date(b.date) - new Date(a.date);
      case 'date-asc':
        return new Date(a.date) - new Date(b.date);
      case 'cost-desc':
        return (b.cost || 0) - (a.cost || 0);
      case 'cost-asc':
        return (a.cost || 0) - (b.cost || 0);
      case 'km-desc':
        return (b.km_at_maintenance || 0) - (a.km_at_maintenance || 0);
      case 'km-asc':
        return (a.km_at_maintenance || 0) - (b.km_at_maintenance || 0);
      default:
        return new Date(b.date) - new Date(a.date);
    }
  });

  if (maintenance.length === 0) {
    maintenanceList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔧</div>
        <h3>No hay mantenimientos registrados</h3>
        <p>Registra el primer mantenimiento de tus bicicletas para hacer seguimiento profesional</p>
      </div>
    `;
    return;
  }

  const currencySymbol = defaultConfig.currency_symbol;

  maintenanceList.innerHTML = maintenance.map(m => {
    const date = new Date(m.date);
    const formattedDate = date.toLocaleDateString('es-ES', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    return `
      <div class="maintenance-item">
        
        ${m.imageURL 
          ? `<img src="${m.imageURL}" alt="Foto de ${m.maintenance_type}" class="maintenance-card-img">`
          : ''
        }

        <div class="maintenance-header">
          <div>
            <div class="maintenance-title">${m.maintenance_type}</div>
            <div class="maintenance-bike">🚴 ${m.bike_name}</div>
          </div>
          <div class="maintenance-actions">
              <button class="edit-maintenance" onclick="showEditMaintenanceModal('${m.id}')" title="Editar mantenimiento">✏️</button>
              <button class="delete-maintenance" onclick="showDeleteMaintenanceConfirmation('${m.id}')" title="Eliminar mantenimiento">×</button>
          </div>
        </div>
        <div>
          <span class="maintenance-component">${m.component}</span>
          ${m.cost > 0 ? `<span class="maintenance-cost">${m.cost.toFixed(2)} ${currencySymbol}</span>` : ''}
        </div>
        <div class="maintenance-meta">
          <div class="meta-item">📅 ${formattedDate}</div>
          ${m.km_at_maintenance ? `<div class="meta-item">📍 ${m.km_at_maintenance.toFixed(1)} km</div>` : ''}
          ${m.next_maintenance_km ? `<div class="meta-item">🔔 Próximo en ${m.next_maintenance_km} km</div>` : ''}
        </div>
        ${m.notes ? `<div class="maintenance-notes">💬 ${m.notes}</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderStock() {
  const stockList = document.getElementById('stock-list');
  let stock = allData.filter(d => d.type === 'stock');

  if (currentStockCategoryFilter) {
    stock = stock.filter(s => s.stock_category === currentStockCategoryFilter);
  }

  if (currentStockStatusFilter) {
    stock = stock.filter(s => {
      if (currentStockStatusFilter === 'ok') return s.stock_quantity > s.stock_min_quantity;
      if (currentStockStatusFilter === 'low') return s.stock_quantity > 0 && s.stock_quantity <= s.stock_min_quantity;
      if (currentStockStatusFilter === 'out') return s.stock_quantity === 0;
      return true;
    });
  }

  if (currentStockSearch) {
    const searchLower = currentStockSearch.toLowerCase();
    stock = stock.filter(s => 
      s.stock_name.toLowerCase().includes(searchLower) ||
      s.stock_category.toLowerCase().includes(searchLower) ||
      (s.stock_brand && s.stock_brand.toLowerCase().includes(searchLower)) ||
      (s.stock_location && s.stock_location.toLowerCase().includes(searchLower))
    );
  }

  if (stock.length === 0) {
    stockList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📦</div>
        <h3>No hay materiales en el inventario</h3>
        <p>Añade componentes y materiales para gestionar tu stock</p>
      </div>
    `;
    return;
  }

  const currencySymbol = defaultConfig.currency_symbol;

  stockList.innerHTML = stock.map(s => {
    const isLowStock = s.stock_quantity > 0 && s.stock_quantity <= s.stock_min_quantity;
    const isOutOfStock = s.stock_quantity === 0;
    
    let cardClass = 'stock-card';
    let quantityClass = 'stock-quantity-display';
    let alertHTML = '';
    
    if (isOutOfStock) {
      cardClass += ' out-of-stock';
      quantityClass += ' out';
      alertHTML = '<div class="stock-alert danger">🚨 SIN STOCK - Reponer urgentemente</div>';
    } else if (isLowStock) {
      cardClass += ' low-stock';
      quantityClass += ' low';
      alertHTML = '<div class="stock-alert warning">⚠️ STOCK BAJO - Considerar reposición</div>';
    }

    const categoryIcons = {
      'Transmisión': '⛓️',
      'Frenos': '🛑',
      'Ruedas': '🛞',
      'Suspensión': '🔩',
      'Cockpit': '🎯',
      'Sillín': '🪑',
      'Lubricantes': '💧',
      'Herramientas': '🔧',
      'Accesorios': '✨',
      'Otros': '📦'
    };

    const icon = categoryIcons[s.stock_category] || '📦';
    const totalValue = s.stock_quantity * s.stock_unit_price;

    return `
      <div class="${cardClass}">
        
        ${s.imageURL 
          ? `<img src="${s.imageURL}" alt="Foto de ${s.stock_name}" class="stock-card-img">`
          : ''
        }

        <div class="stock-header">
          <div>
            <div class="stock-icon">${icon}</div>
            <div class="stock-name">${s.stock_name}</div>
            <span class="stock-category">${s.stock_category}</span>
            ${s.stock_brand ? `<div class="stock-brand">Marca: ${s.stock_brand}</div>` : ''}
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="edit-bike-btn" onclick="showEditStockModal('${s.id}')" title="Editar material">✏️</button>
            <button class="delete-stock" onclick="showDeleteStockConfirmation('${s.id}')" title="Eliminar material">×</button>
          </div>
        </div>
        <div class="${quantityClass}">
          <div>
            <div style="font-size: 12px; opacity: 0.9;">CANTIDAD</div>
            <div style="font-size: 24px;">${s.stock_quantity} uds</div>
          </div>
          <div class="quantity-controls">
            <button class="quantity-btn" onclick="updateStockQuantity('${s.id}', -1)" title="Reducir cantidad">−</button>
            <button class="quantity-btn" onclick="updateStockQuantity('${s.id}', 1)" title="Aumentar cantidad">+</button>
          </div>
        </div>
        ${alertHTML}
        <div class="stock-details">
          <div class="stock-detail-item">
            <span class="stock-detail-label">Stock Mínimo:</span>
            <span class="stock-detail-value">${s.stock_min_quantity} uds</span>
          </div>
          ${s.stock_unit_price > 0 ? `
            <div class="stock-detail-item">
              <span class="stock-detail-label">Precio Unitario:</span>
              <span class="stock-detail-value">${s.stock_unit_price.toFixed(2)} ${currencySymbol}</span>
            </div>
            <div class="stock-detail-item">
              <span class="stock-detail-label">Valor Total:</span>
              <span class="stock-detail-value">${totalValue.toFixed(2)} ${currencySymbol}</span>
            </div>
          ` : ''}
          ${s.stock_location ? `
            <div class="stock-detail-item">
              <span class="stock-detail-label">Ubicación:</span>
              <span class="stock-detail-value">${s.stock_location}</span>
            </div>
          ` : ''}
        </div>
        ${s.stock_notes ? `<div class="stock-notes-display">💬 ${s.stock_notes}</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderStats() {
  const bikes = allData.filter(d => d.type === 'bike');
  const maintenance = allData.filter(d => d.type === 'maintenance');
  const stock = allData.filter(d => d.type === 'stock');
  
  const totalKm = bikes.reduce((sum, b) => sum + (b.total_km || 0), 0);
  const totalCost = maintenance.reduce((sum, m) => sum + (m.cost || 0), 0);
  const avgCostPerBike = bikes.length > 0 ? totalCost / bikes.length : 0;
  const costPerKm = totalCost > 0 && totalKm > 0 ? totalCost / totalKm : 0;
  const avgMaintenancePerBike = bikes.length > 0 ? maintenance.length / bikes.length : 0;
  
  const totalStockValue = stock.reduce((sum, s) => sum + (s.stock_quantity * s.stock_unit_price), 0);
  const lowStockItems = stock.filter(s => s.stock_quantity > 0 && s.stock_quantity <= s.stock_min_quantity).length;
  const outOfStockItems = stock.filter(s => s.stock_quantity === 0).length;
  
  const currencySymbol = defaultConfig.currency_symbol;

  // CORREGIDO: Protección contra null en el elemento general-stats
  const generalStats = document.getElementById('general-stats');
  if (generalStats) {
      generalStats.innerHTML = `
        <div class="stat-card">
          <span class="stat-card-icon">🚴</span>
          <div class="stat-value">${bikes.length}</div>
          <div class="stat-label">Bicicletas</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-icon">🔧</span>
          <div class="stat-value">${maintenance.length}</div>
          <div class="stat-label">Mantenimientos</div>
          <div class="stat-sublabel">${avgMaintenancePerBike.toFixed(1)} por bici</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-icon">📍</span>
          <div class="stat-value">${totalKm.toFixed(0)}</div>
          <div class="stat-label">Km Totales</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-icon">💰</span>
          <div class="stat-value">${totalCost.toFixed(0)}${currencySymbol}</div>
          <div class="stat-label">Coste Total</div>
          <div class="stat-sublabel">${costPerKm.toFixed(2)}${currencySymbol}/km</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-icon">📦</span>
          <div class="stat-value">${stock.length}</div>
          <div class="stat-label">Materiales</div>
          <div class="stat-sublabel">${totalStockValue.toFixed(0)}${currencySymbol} en stock</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-icon">⚠️</span>
          <div class="stat-value">${lowStockItems + outOfStockItems}</div>
          <div class="stat-label">Alertas Stock</div>
          <div class="stat-sublabel">${outOfStockItems} sin stock</div>
        </div>
      `;
  }


  renderTopComponents(maintenance);
  renderBikeDetails(bikes, maintenance, currencySymbol);
}

// CORREGIDO: Protección contra null en renderTopComponents
function renderTopComponents(maintenance) {
    const topComponentsSection = document.getElementById('top-components-section');
    if (!topComponentsSection) {
        return; 
    }
    
    const componentCounts = {};
    maintenance.forEach(m => {
        componentCounts[m.component] = (componentCounts[m.component] || 0) + 1;
    });

    const topComponents = Object.entries(componentCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    if (topComponents.length === 0) {
        topComponentsSection.innerHTML = '';
        return;
    }

    const maxCount = topComponents[0][1];

    const topComponentsHTML = topComponents.map(([component, count], index) => {
        const percentage = (count / maxCount) * 100;
        let rankClass = '';
        if (index === 0) rankClass = 'gold';
        else if (index === 1) rankClass = 'silver';
        else if (index === 2) rankClass = 'bronze';

        return `
          <div class="top-component-item">
            <div class="rank-badge ${rankClass}">${index + 1}</div>
            <div style="flex: 1;">
              <div style="font-weight: 700; color: #2d3748; margin-bottom: 5px;">${component}</div>
              <div class="component-bar">
                <div class="component-bar-fill" style="width: ${percentage}%"></div>
              </div>
            </div>
            <div style="font-weight: 800; color: #667eea; font-size: 18px;">${count}</div>
          </div>
        `;
    }).join('');

    topComponentsSection.innerHTML = `
        <div class="top-components">
          <h3>🏆 Top 5 Componentes Más Cambiados</h3>
          ${topComponentsHTML}
        </div>
      `;
}

function renderBikeDetails(bikes, maintenance, currencySymbol) {
  const bikeDetailsSection = document.getElementById('bike-details-section');
  
  if (bikes.length === 0) {
    if (bikeDetailsSection) bikeDetailsSection.innerHTML = '';
    return;
  }

  if (!bikeDetailsSection) return; // Protección

  bikeDetailsSection.innerHTML = bikes.map(bike => {
    const bikeMaintenance = maintenance.filter(m => m.bike_id === bike.id);
    const componentHistory = {};
    
    bikeMaintenance.forEach(m => {
      if (!componentHistory[m.component]) {
        componentHistory[m.component] = [];
      }
      componentHistory[m.component].push(m);
    });

    const componentList = Object.entries(componentHistory)
      .map(([component, records]) => {
        records.sort((a, b) => new Date(b.date) - new Date(a.date));
        const lastMaintenance = records[0];
        const count = records.length;
        const totalCostComponent = records.reduce((sum, r) => sum + (r.cost || 0), 0);
        
        return `
          <div class="component-item">
            <div>
              <div class="component-name">${component}</div>
              <div style="font-size: 12px; color: #718096; margin-top: 4px;">
                ${count} cambio${count > 1 ? 's' : ''} • Último: ${new Date(lastMaintenance.date).toLocaleDateString('es-ES')}
              </div>
            </div>
            <div class="component-info">
              ${lastMaintenance.km_at_maintenance ? `<span class="km-badge">${lastMaintenance.km_at_maintenance.toFixed(0)} km</span>` : ''}
              ${totalCostComponent > 0 ? `<span>${totalCostComponent.toFixed(2)} ${currencySymbol}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');

    return `
      <div class="component-history">
        <h3>🚴 ${bike.bike_name} - Historial de Componentes</h3>
        <div class="component-list">
          ${componentList || '<p style="color: #718096; text-align: center;">No hay mantenimientos registrados para esta bicicleta</p>'}
        </div>
      </div>
    `;
  }).join('');
}

function updateBikeSelectors() {
  const bikes = allData.filter(d => d.type === 'bike');
  const maintenanceBikeSelect = document.getElementById('maintenance-bike');
  const filterBikeSelect = document.getElementById('filter-bike');

  const bikeOptions = bikes.map(bike => 
    `<option value="${bike.id}">${bike.bike_name} (${bike.total_km.toFixed(1)} km)</option>`
  ).join('');

  if (maintenanceBikeSelect) maintenanceBikeSelect.innerHTML = '<option value="">Selecciona una bicicleta</option>' + bikeOptions;
  if (filterBikeSelect) filterBikeSelect.innerHTML = '<option value="">Todas</option>' + bikeOptions;
}

function updateComponentFilter() {
  const maintenance = allData.filter(d => d.type === 'maintenance');
  const components = [...new Set(maintenance.map(m => m.component))].sort();
  
  const filterComponentSelect = document.getElementById('filter-component');
  const componentOptions = components.map(comp => 
    `<option value="${comp}">${comp}</option>`
  ).join('');

  if (filterComponentSelect) filterComponentSelect.innerHTML = '<option value="">Todos</option>' + componentOptions;
}

function updateStockCategoryFilter() {
  const stock = allData.filter(d => d.type === 'stock');
  const categories = [...new Set(stock.map(s => s.stock_category))].sort();
  
  const filterCategorySelect = document.getElementById('filter-stock-category');
  
  // Asegurarse de que el selector existe antes de intentar modificarlo
  if (filterCategorySelect) {
    const categoryOptions = categories.map(cat => 
      `<option value="${cat}">${cat}</option>`
    ).join('');
    filterCategorySelect.innerHTML = '<option value="">Todas</option>' + categoryOptions;
  }
}

let currentFilter = "";
let currentComponentFilter = "";
let currentSearch = "";
let currentSort = "date-desc";
let currentStockCategoryFilter = "";
let currentStockStatusFilter = "";
let currentStockSearch = "";


function filterMaintenance() {
  const filterBike = document.getElementById('filter-bike');
  const filterComponent = document.getElementById('filter-component');
  const searchMaintenance = document.getElementById('search-maintenance');
  const sortMaintenance = document.getElementById('sort-maintenance');
  
  currentFilter = filterBike ? filterBike.value : "";
  currentComponentFilter = filterComponent ? filterComponent.value : "";
  currentSearch = searchMaintenance ? searchMaintenance.value : "";
  currentSort = sortMaintenance ? sortMaintenance.value : "date-desc";
  
  renderMaintenance();
}

function filterStock() {
  // Asegurarse de que los elementos existen antes de leerlos
  const categorySelect = document.getElementById('filter-stock-category');
  const statusSelect = document.getElementById('filter-stock-status');
  const searchInput = document.getElementById('search-stock');

  currentStockCategoryFilter = categorySelect ? categorySelect.value : "";
  currentStockStatusFilter = statusSelect ? statusSelect.value : "";
  currentStockSearch = searchInput ? searchInput.value : "";
  
  renderStock();
}


function showUpdateKmModal(bikeId) {
  const bike = allData.find(d => d.id === bikeId);
  if (!bike) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'km-modal'; // Añadir ID para closeModal
  
  const currencySymbol = defaultConfig.currency_symbol;

  modal.innerHTML = `
    <div class="modal-content">
      <h3 style="margin: 0 0 20px 0; color: #2d3748; font-size: 22px; font-weight: 800;">
        📍 Actualizar Kilometraje
      </h3>
      <div style="background: #f7fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <p style="margin: 0 0 5px 0; color: #718096; font-size: 13px; font-weight: 600;">BICICLETA</p>
        <p style="margin: 0; color: #2d3748; font-size: 16px; font-weight: 700;">${bike.bike_name}</p>
        <p style="margin: 10px 0 0 0; color: #4a5568; font-size: 14px;">
          <strong>Kilometraje actual:</strong> ${bike.total_km.toFixed(1)} km
        </p>
      </div>
      <div class="form-group">
        <label for="new-km">Nuevo Kilometraje Total</label>
        <input type="number" id="new-km" value="${bike.total_km}" min="${bike.total_km}" step="0.1" style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 15px;">
      </div>
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button onclick="updateBikeKm('${bikeId}')" class="btn-primary" style="flex: 1;">Actualizar</button>
        <button onclick="closeModal('km-modal')" class="btn-secondary" style="flex: 1;">Cancelar</button>
      </div>
    </div>
  `;
  
  modal.onclick = (e) => {
    if (e.target === modal) closeModal('km-modal');
  };
  
  document.body.appendChild(modal);
}

function showDeleteBikeConfirmation(bikeId) {
  const bike = allData.find(d => d.id === bikeId);
  if (!bike) return;

  // Crear el overlay del modal
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'delete-bike-modal'; // ID único para este modal
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 450px;">
      <h3 style="margin: 0 0 15px 0; color: #e53e3e; font-size: 22px; font-weight: 800;">
        🚨 Confirmar Eliminación
      </h3>
      <p style="font-size: 16px; color: #2d3748; line-height: 1.6; margin-bottom: 25px;">
        ¿Estás seguro de que quieres eliminar la bicicleta <strong>${bike.bike_name}</strong>?
        <br>
        <span style="font-weight: 700; color: #c53030; display: block; margin-top: 10px;">Esta acción no se puede deshacer.</span>
      </p>
      
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button id="confirm-delete-btn" class="btn-primary" style="flex: 1; background-color: #e53e3e; border-color: #e53e3e;">
          Sí, Eliminar
        </button>
        <button onclick="closeModal('delete-bike-modal')" class="btn-secondary" style="flex: 1;">
          Cancelar
        </button>
      </div>
    </div>
  `;
  
  // Añadir evento para cerrar si se hace clic fuera del contenido
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal('delete-bike-modal');
    }
  };
  
  // Añadir el modal al body
  document.body.appendChild(modal);

  // Añadir el listener al botón de confirmar (lo hacemos así para poder deshabilitarlo)
  document.getElementById('confirm-delete-btn').onclick = async () => {
    await deleteBike(bikeId); // Llamamos a la función de borrado
  };
}

// Modal de confirmación para eliminar inventario
function showDeleteStockConfirmation(stockId) {
  const stock = allData.find(d => d.id === stockId);
  if (!stock) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'delete-stock-modal';
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 450px;">
      <h3 style="margin: 0 0 15px 0; color: #e53e3e; font-size: 22px; font-weight: 800;">
        🚨 Confirmar Eliminación
      </h3>
      <p style="font-size: 16px; color: #2d3748; line-height: 1.6; margin-bottom: 25px;">
        ¿Estás seguro de que quieres eliminar <strong>${stock.stock_name}</strong> del inventario?
        <br>
        <span style="font-weight: 700; color: #c53030; display: block; margin-top: 10px;">Esta acción no se puede deshacer.</span>
      </p>
      
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button id="confirm-delete-stock-btn" class="btn-primary" style="flex: 1; background-color: #e53e3e; border-color: #e53e3e;">
          Sí, Eliminar
        </button>
        <button onclick="closeModal('delete-stock-modal')" class="btn-secondary" style="flex: 1;">
          Cancelar
        </button>
      </div>
    </div>
  `;
  
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal('delete-stock-modal');
    }
  };
  
  document.body.appendChild(modal);

  document.getElementById('confirm-delete-stock-btn').onclick = async () => {
    await deleteStock(stockId);
  };
}

// Modal de confirmación para eliminar mantenimiento
function showDeleteMaintenanceConfirmation(maintenanceId) {
  const maintenance = allData.find(d => d.id === maintenanceId);
  if (!maintenance) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'delete-maintenance-modal';
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 450px;">
      <h3 style="margin: 0 0 15px 0; color: #e53e3e; font-size: 22px; font-weight: 800;">
        🚨 Confirmar Eliminación
      </h3>
      <p style="font-size: 16px; color: #2d3748; line-height: 1.6; margin-bottom: 25px;">
        ¿Estás seguro de que quieres eliminar el mantenimiento "${maintenance.maintenance_type}" para la bicicleta "<strong>${maintenance.bike_name}</strong>"?
        <br>
        <span style="font-weight: 700; color: #c53030; display: block; margin-top: 10px;">Esta acción no se puede deshacer.</span>
      </p>
      
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button id="confirm-delete-maintenance-btn" class="btn-primary" style="flex: 1; background-color: #e53e3e; border-color: #e53e3e;">
          Sí, Eliminar
        </button>
        <button onclick="closeModal('delete-maintenance-modal')" class="btn-secondary" style="flex: 1;">
          Cancelar
        </button>
      </div>
    </div>
  `;
  
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal('delete-maintenance-modal');
    }
  };
  
  document.body.appendChild(modal);

  document.getElementById('confirm-delete-maintenance-btn').onclick = async () => {
    await deleteMaintenance(maintenanceId);
  };
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    // Para evitar problemas en modals que se cierran desde dentro de otros
    if (modal.parentElement) {
      modal.parentElement.removeChild(modal);
    }
  }
}


function showToast(message) {
  let toast = document.querySelector('.toast');
  if (toast) toast.remove(); 

  toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Manejar el cierre del modal de edición de bicicleta con la tecla ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
      if (document.getElementById('edit-maintenance-modal')) closeModal('edit-maintenance-modal');
      if (document.getElementById('edit-bike-modal')) closeModal('edit-bike-modal');
      if (document.getElementById('km-modal')) closeModal('km-modal');
      if (document.getElementById('delete-bike-modal')) closeModal('delete-bike-modal');
      
      // MODALES DE STOCK
      if (document.getElementById('edit-stock-modal')) closeModal('edit-stock-modal');
      if (document.getElementById('delete-stock-modal')) closeModal('delete-stock-modal');

      // MODAL DE MANTENIMIENTO
      if (document.getElementById('delete-maintenance-modal')) closeModal('delete-maintenance-modal');
  }
});

init();
