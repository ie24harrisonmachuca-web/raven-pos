CREATE DATABASE IF NOT EXISTS raven_analitica CHARACTER SET utf8mb4;
USE raven_analitica;
CREATE TABLE IF NOT EXISTS empresas(id VARCHAR(36) PRIMARY KEY,nombre VARCHAR(160) NOT NULL);
CREATE TABLE IF NOT EXISTS productos(empresa_id VARCHAR(36) NOT NULL,id VARCHAR(36) NOT NULL,nombre VARCHAR(180) NOT NULL,stock INT NOT NULL,precio_centimos INT NOT NULL,PRIMARY KEY(empresa_id,id),FOREIGN KEY(empresa_id) REFERENCES empresas(id),CHECK(stock>=0),CHECK(precio_centimos>=0));
CREATE TABLE IF NOT EXISTS ventas(empresa_id VARCHAR(36) NOT NULL,id VARCHAR(36) NOT NULL,fecha DATE NOT NULL,total_centimos INT NOT NULL,estado VARCHAR(30) NOT NULL,PRIMARY KEY(empresa_id,id),FOREIGN KEY(empresa_id) REFERENCES empresas(id));
CREATE OR REPLACE VIEW vista_ventas_diarias AS SELECT empresa_id,fecha,COUNT(*) cantidad,SUM(total_centimos) total_centimos FROM ventas WHERE estado='paid' GROUP BY empresa_id,fecha;
DELIMITER $$
DROP PROCEDURE IF EXISTS consultar_ventas_periodo$$
CREATE PROCEDURE consultar_ventas_periodo(IN p_empresa VARCHAR(36),IN p_desde DATE,IN p_hasta DATE)
SQL SECURITY INVOKER READS SQL DATA
BEGIN
 IF p_desde IS NULL OR p_hasta IS NULL OR p_desde>p_hasta THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Periodo de consulta no valido'; END IF;
 SELECT fecha,cantidad,total_centimos FROM vista_ventas_diarias WHERE empresa_id=p_empresa AND fecha BETWEEN p_desde AND p_hasta ORDER BY fecha;
END$$
DROP TRIGGER IF EXISTS validar_producto_importado$$
CREATE TRIGGER validar_producto_importado BEFORE INSERT ON productos FOR EACH ROW
BEGIN
 IF NEW.stock<0 OR NEW.precio_centimos<0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Stock y precio deben ser no negativos'; END IF;
END$$
DELIMITER ;
